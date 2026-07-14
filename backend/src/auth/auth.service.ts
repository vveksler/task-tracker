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

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto): Promise<TokenPair> {
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
      select: { id: true, email: true },
    });

    return this.issueTokens(user.id, user.email);
  }

  async login(dto: LoginDto): Promise<TokenPair> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true, email: true, passwordHash: true },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    return this.issueTokens(user.id, user.email);
  }

  /**
   * Validate the refresh token from the cookie, issue new token pair.
   *
   * Hunt for (Phase 1): three-step check — not found / revoked / expired.
   * Each condition has its own rejection reason. A revoked token (logged out)
   * is explicitly detected and rejected, blocking replay attacks.
   */
  async refresh(rawRefreshToken: string): Promise<TokenPair> {
    const tokenHash = this.hashToken(rawRefreshToken);

    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (!stored) {
      throw new UnauthorizedException('Invalid refresh token');
    }
    if (stored.revokedAt) {
      throw new UnauthorizedException('Token has been revoked');
    }
    if (stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Token expired');
    }

    // Rotate: revoke the old token, issue a new pair.
    // Token rotation limits the window if a refresh token leaks.
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    // Look up the user to get current email for the access token payload.
    const user = await this.prisma.user.findUnique({
      where: { id: stored.userId },
      select: { id: true, email: true },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    return this.issueTokens(user.id, user.email);
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
  ): Promise<TokenPair> {
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
