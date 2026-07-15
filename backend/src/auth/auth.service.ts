import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

const BCRYPT_ROUNDS = 12;
const REFRESH_TOKEN_BYTES = 40;
const REFRESH_TOKEN_DAYS = 7;

// Grace period: if a rotated (revoked) token is reused within this window,
// look up its replacement instead of rejecting. This handles the race
// condition where parallel requests (e.g. Next.js middleware + RSC) both
// try to use the same token, and the second arrives after the first rotated it.
const GRACE_PERIOD_MS = 30_000; // 30 seconds

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<AuthResult> {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true },
    });

    if (existing) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        name: dto.name,
      },
      select: { id: true, email: true, name: true },
    });

    const tokens = await this.issueTokens(user.id, user.email);
    return { ...tokens, user };
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true, email: true, name: true, passwordHash: true },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const tokens = await this.issueTokens(user.id, user.email);
    return {
      ...tokens,
      user: { id: user.id, email: user.email, name: user.name },
    };
  }

  /**
   * Validate the refresh token and issue new credentials with full rotation.
   *
   * Grace period: when a token has been revoked by rotation (not by logout)
   * and the reuse happens within GRACE_PERIOD_MS, we follow the
   * `replacedByHash` chain to the current live token and return a fresh
   * access token from it — instead of rejecting. This handles the race
   * condition where parallel requests (e.g. Next.js middleware + RSC) both
   * present the same token and the second arrives after the first rotated it.
   *
   * If a revoked token is reused OUTSIDE the grace period, it is treated as
   * a potential token theft — the entire family could be revoked in a
   * production system, but here we simply reject with "Token has been revoked".
   *
   * Hunt for (Phase 1): three-step check — not found / revoked / expired.
   */
  async refresh(rawRefreshToken: string): Promise<AuthResult> {
    const tokenHash = this.hashToken(rawRefreshToken);

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (!stored) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Token expired');
    }

    if (stored.revokedAt) {
      return this.handleRevokedToken(stored);
    }

    const user = await this.prisma.user.findUnique({
      where: { id: stored.userId },
      select: { id: true, email: true, name: true },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Revoke old token, issue a completely new pair, link them
    const tokens = await this.issueTokens(user.id, user.email);

    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: {
        revokedAt: new Date(),
        replacedByHash: this.hashToken(tokens.refreshToken),
      },
    });

    return { ...tokens, user };
  }

  async logout(rawRefreshToken: string): Promise<void> {
    const tokenHash = this.hashToken(rawRefreshToken);

    // Mark as revoked (not deleted) — so we can detect replay attempts.
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // ── private helpers ──

  /**
   * Handle a revoked refresh token: if it was revoked by rotation (has
   * replacedByHash) within the grace period, follow the chain and issue
   * a fresh access token from the replacement. Otherwise reject.
   */
  private async handleRevokedToken(stored: {
    id: string;
    revokedAt: Date | null;
    replacedByHash: string | null;
    userId: string;
  }): Promise<AuthResult> {
    const revokedAt = stored.revokedAt!;
    const elapsed = Date.now() - revokedAt.getTime();

    // Outside grace period or no replacement chain → reject
    if (elapsed > GRACE_PERIOD_MS || !stored.replacedByHash) {
      throw new UnauthorizedException('Token has been revoked');
    }

    // Follow the replacement chain (max 5 hops to prevent infinite loops)
    let replacement = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: stored.replacedByHash },
    });

    for (let hops = 0; hops < 5 && replacement?.replacedByHash; hops++) {
      replacement = await this.prisma.refreshToken.findUnique({
        where: { tokenHash: replacement.replacedByHash },
      });
    }

    if (!replacement || replacement.revokedAt || replacement.expiresAt < new Date()) {
      throw new UnauthorizedException('Token has been revoked');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: replacement.userId },
      select: { id: true, email: true, name: true },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Issue a fresh access token; the replacement refresh token is still live
    const accessToken = this.jwt.sign(
      { sub: user.id, email: user.email },
      {
        secret: this.config.get<string>('jwt.accessSecret'),
        expiresIn: this.config.get<string>(
          'jwt.accessExpiresIn',
        ) as `${number}m`,
      },
    );

    // Return the raw replacement token? No — the caller doesn't know it.
    // Instead, return the replacement's hash as a sentinel; the caller
    // will get a fresh access token, which is what matters. The refresh
    // token in the response won't be usable for another rotation, but the
    // caller (middleware) only needs the access token anyway.
    //
    // Trade-off: we return an empty string for refreshToken here because
    // the grace period consumer (middleware) only cares about accessToken.
    // The BFF client-side refresh path always gets a fresh token pair from
    // a non-revoked token, so this path is only hit by middleware.
    return { accessToken, refreshToken: '', user };
  }

  /**
   * Issue an access token (JWT) + refresh token (random hex).
   *
   * Trade-off: refresh token is a random 40-byte hex string, NOT a JWT.
   * It's always validated via DB lookup (needed for revocation check anyway),
   * so JWT verification would be redundant overhead. Random bytes are also
   * smaller (~80 chars vs ~300 chars JWT), making the cookie more compact.
   */
  private async issueTokens(
    userId: string,
    email: string,
  ): Promise<Pick<AuthResult, 'accessToken' | 'refreshToken'>> {
    const accessToken = this.jwt.sign(
      { sub: userId, email },
      {
        secret: this.config.get<string>('jwt.accessSecret'),
        expiresIn: this.config.get<string>('jwt.accessExpiresIn') as `${number}m`,
      },
    );

    const refreshToken = randomBytes(REFRESH_TOKEN_BYTES).toString('hex');
    const tokenHash = this.hashToken(refreshToken);

    const expiresAt = new Date(
      Date.now() + REFRESH_TOKEN_DAYS * 24 * 60 * 60 * 1000,
    );

    await this.prisma.refreshToken.create({
      data: {
        tokenHash,
        userId,
        expiresAt,
      },
    });

    return { accessToken, refreshToken };
  }

  /**
   * SHA-256 hash for DB lookup. Not bcrypt — we need to find the row by hash,
   * which requires a deterministic hash. SHA-256 is sufficient here because
   * refresh tokens (40 random bytes = 320 bits of entropy) are not guessable.
   */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
