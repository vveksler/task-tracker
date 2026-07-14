import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { JwtPayload } from '../common/types/jwt-payload';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

const BCRYPT_ROUNDS = 12;

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

    return this.generateTokenPair({ sub: user.id, email: user.email });
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

    return this.generateTokenPair({ sub: user.id, email: user.email });
  }

  /**
   * Validate the refresh token from the cookie, issue new token pair.
   *
   * Hunt for (Phase 1): This method checks the DB for a non-revoked token.
   * If the token was revoked on logout (revokedAt set), this lookup returns
   * null and we throw 401 — blocking replay of a logged-out refresh token.
   */
  async refresh(rawRefreshToken: string): Promise<TokenPair> {
    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(rawRefreshToken, {
        secret: this.config.get<string>('jwt.refreshSecret'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    const tokenHash = this.hashToken(rawRefreshToken);

    const storedToken = await this.prisma.refreshToken.findFirst({
      where: {
        tokenHash,
        userId: payload.sub,
        revokedAt: null,
      },
    });

    if (!storedToken) {
      throw new UnauthorizedException('Refresh token revoked or not found');
    }

    // Rotate: revoke the old token, issue a new pair.
    // Token rotation limits the window if a refresh token leaks.
    await this.prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revokedAt: new Date() },
    });

    return this.generateTokenPair({
      sub: payload.sub,
      email: payload.email,
    });
  }

  async logout(rawRefreshToken: string): Promise<void> {
    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(rawRefreshToken, {
        secret: this.config.get<string>('jwt.refreshSecret'),
      });
    } catch {
      // Token is invalid/expired — nothing to revoke, return silently.
      return;
    }

    const tokenHash = this.hashToken(rawRefreshToken);

    // Mark as revoked (not deleted) — so we can detect replay attempts.
    await this.prisma.refreshToken.updateMany({
      where: {
        tokenHash,
        userId: payload.sub,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
  }

  // ── private helpers ──

  private async generateTokenPair(payload: JwtPayload): Promise<TokenPair> {
    // Spread into a plain object — JwtService.sign expects Record, not a
    // custom interface. Cast expiresIn because @nestjs/jwt v11 uses the
    // `ms` library's StringValue template literal type, but our config
    // returns a plain string (e.g. "15m").
    const jwtPayload = { ...payload };

    const accessToken = this.jwt.sign(jwtPayload, {
      secret: this.config.get<string>('jwt.accessSecret'),
      expiresIn: this.config.get<string>('jwt.accessExpiresIn') as `${number}m`,
    });

    const refreshToken = this.jwt.sign(jwtPayload, {
      secret: this.config.get<string>('jwt.refreshSecret'),
      expiresIn: this.config.get<string>('jwt.refreshExpiresIn') as `${number}d`,
    });

    const tokenHash = this.hashToken(refreshToken);

    const refreshExpiresIn = this.config.get<string>('jwt.refreshExpiresIn') ?? '7d';
    const expiresAt = new Date(
      Date.now() + this.parseDuration(refreshExpiresIn),
    );

    await this.prisma.refreshToken.create({
      data: {
        tokenHash,
        userId: payload.sub,
        expiresAt,
      },
    });

    return { accessToken, refreshToken };
  }

  /**
   * SHA-256 hash for DB lookup. Not bcrypt — we need to find the row by hash,
   * which requires a deterministic hash. SHA-256 is sufficient here because
   * refresh tokens (JWTs) have high entropy from the HMAC signature.
   */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private parseDuration(duration: string): number {
    const match = duration.match(/^(\d+)([smhd])$/);
    if (!match?.[1] || !match[2]) {
      throw new Error(`Invalid duration format: ${duration}`);
    }

    const value = parseInt(match[1], 10);
    const multipliers: Record<string, number> = {
      s: 1000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };

    const multiplier = multipliers[match[2]];
    if (multiplier === undefined) {
      throw new Error(`Unknown duration unit: ${match[2]}`);
    }

    return value * multiplier;
  }
}
