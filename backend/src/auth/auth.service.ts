import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';

const BCRYPT_ROUNDS = 12;
const REFRESH_TOKEN_BYTES = 40;
const REFRESH_TOKEN_DAYS = 7;
const RESET_TOKEN_BYTES = 32;
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const VERIFY_TOKEN_BYTES = 32;
const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

const VERIFY_SENT_MESSAGE =
  'Check your email for a confirmation link to finish signing up.';
const RESEND_VERIFY_MESSAGE =
  'If an unverified account with that email exists, a confirmation link has been sent.';

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

interface GoogleTokenResponse {
  access_token?: string;
  id_token?: string;
  error?: string;
  error_description?: string;
}

interface GoogleUserInfo {
  id: string;
  email: string;
  verified_email: boolean;
  name?: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
  ) {}

  async register(dto: RegisterDto): Promise<{ message: string }> {
    if (!this.mail.isConfigured()) {
      throw new ServiceUnavailableException(
        'Email is not configured. Set MAIL_HOST (and related MAIL_* vars).',
      );
    }

    const email = dto.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({
      where: { email },
      select: {
        id: true,
        email: true,
        emailVerifiedAt: true,
        passwordHash: true,
      },
    });

    if (existing?.emailVerifiedAt) {
      throw new ConflictException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    let user: { id: string; email: string };

    if (existing && !existing.emailVerifiedAt) {
      // Unverified re-signup: refresh credentials and resend confirmation.
      user = await this.prisma.user.update({
        where: { id: existing.id },
        data: {
          passwordHash,
          name: dto.name,
          emailVerifiedAt: null,
        },
        select: { id: true, email: true },
      });
    } else {
      user = await this.prisma.user.create({
        data: {
          email,
          passwordHash,
          name: dto.name,
          emailVerifiedAt: null,
        },
        select: { id: true, email: true },
      });
    }

    await this.sendVerificationEmail(user.id, user.email);
    return { message: VERIFY_SENT_MESSAGE };
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
      select: {
        id: true,
        email: true,
        name: true,
        passwordHash: true,
        emailVerifiedAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.passwordHash) {
      throw new UnauthorizedException(
        'This account uses Google sign-in. Continue with Google instead.',
      );
    }

    const passwordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.emailVerifiedAt) {
      throw new UnauthorizedException(
        'Please verify your email before signing in. Check your inbox for a confirmation link.',
      );
    }

    const tokens = await this.issueTokens(user.id, user.email);

    // Opportunistic cleanup: delete expired or old revoked tokens
    // to prevent unbounded table growth.
    this.prisma.refreshToken
      .deleteMany({
        where: {
          userId: user.id,
          OR: [
            { expiresAt: { lt: new Date() } },
            {
              revokedAt: {
                lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
              },
            },
          ],
        },
      })
      .catch(() => {
        /* best-effort cleanup — never block login */
      });

    return {
      ...tokens,
      user: { id: user.id, email: user.email, name: user.name },
    };
  }

  /**
   * Exchange a Google authorization code for profile, then login or register.
   * Linking policy (2A): if email already exists, attach googleId and sign in.
   */
  async loginWithGoogle(code: string): Promise<AuthResult> {
    const clientId = this.config.get<string>('google.clientId') ?? '';
    const clientSecret = this.config.get<string>('google.clientSecret') ?? '';
    const callbackUrl = this.config.get<string>('google.callbackUrl') ?? '';

    if (!clientId || !clientSecret || !callbackUrl) {
      throw new ServiceUnavailableException(
        'Google sign-in is not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_CALLBACK_URL.',
      );
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: callbackUrl,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = (await tokenRes.json()) as GoogleTokenResponse;
    if (!tokenRes.ok || !tokenData.access_token) {
      this.logger.warn(
        `Google token exchange failed: ${tokenData.error_description ?? tokenData.error ?? tokenRes.status}`,
      );
      throw new UnauthorizedException('Google authentication failed');
    }

    const profileRes = await fetch(
      'https://www.googleapis.com/oauth2/v2/userinfo',
      {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      },
    );

    if (!profileRes.ok) {
      throw new UnauthorizedException('Failed to load Google profile');
    }

    const profile = (await profileRes.json()) as GoogleUserInfo;
    if (!profile.email || !profile.verified_email) {
      throw new UnauthorizedException(
        'Google account email is missing or not verified',
      );
    }

    const googleId = profile.id;
    const email = profile.email.toLowerCase();
    const name = profile.name?.trim() || email.split('@')[0] || 'User';

    const now = new Date();

    let user = await this.prisma.user.findUnique({
      where: { googleId },
      select: { id: true, email: true, name: true, emailVerifiedAt: true },
    });

    if (!user) {
      const byEmail = await this.prisma.user.findUnique({
        where: { email },
        select: {
          id: true,
          email: true,
          name: true,
          googleId: true,
          emailVerifiedAt: true,
        },
      });

      if (byEmail) {
        if (byEmail.googleId && byEmail.googleId !== googleId) {
          throw new ConflictException(
            'This email is already linked to a different Google account',
          );
        }

        user = await this.prisma.user.update({
          where: { id: byEmail.id },
          data: {
            googleId,
            emailVerifiedAt: byEmail.emailVerifiedAt ?? now,
          },
          select: { id: true, email: true, name: true, emailVerifiedAt: true },
        });
      } else {
        user = await this.prisma.user.create({
          data: {
            email,
            name,
            googleId,
            passwordHash: null,
            emailVerifiedAt: now,
          },
          select: { id: true, email: true, name: true, emailVerifiedAt: true },
        });
      }
    } else if (!user.emailVerifiedAt) {
      user = await this.prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: now },
        select: { id: true, email: true, name: true, emailVerifiedAt: true },
      });
    }

    const tokens = await this.issueTokens(user.id, user.email);
    return {
      ...tokens,
      user: { id: user.id, email: user.email, name: user.name },
    };
  }

  async verifyEmail(rawToken: string): Promise<AuthResult> {
    const tokenHash = this.hashToken(rawToken);

    const stored = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
    });

    if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired verification token');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: stored.userId },
      select: { id: true, email: true, name: true, emailVerifiedAt: true },
    });

    if (!user) {
      throw new BadRequestException('Invalid or expired verification token');
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        data: { emailVerifiedAt: user.emailVerifiedAt ?? new Date() },
      }),
      this.prisma.emailVerificationToken.update({
        where: { id: stored.id },
        data: { usedAt: new Date() },
      }),
      this.prisma.emailVerificationToken.updateMany({
        where: {
          userId: user.id,
          usedAt: null,
          id: { not: stored.id },
        },
        data: { usedAt: new Date() },
      }),
    ]);

    const tokens = await this.issueTokens(user.id, user.email);
    return {
      ...tokens,
      user: { id: user.id, email: user.email, name: user.name },
    };
  }

  /**
   * Always returns success for valid-shaped emails (no enumeration).
   * Sends only when the user exists, has a password, and is not yet verified.
   */
  async resendVerification(email: string): Promise<{ message: string }> {
    const normalized = email.toLowerCase();

    const user = await this.prisma.user.findUnique({
      where: { email: normalized },
      select: {
        id: true,
        email: true,
        passwordHash: true,
        emailVerifiedAt: true,
      },
    });

    if (!user?.passwordHash || user.emailVerifiedAt) {
      return { message: RESEND_VERIFY_MESSAGE };
    }

    if (!this.mail.isConfigured()) {
      throw new ServiceUnavailableException(
        'Email is not configured. Set MAIL_HOST (and related MAIL_* vars).',
      );
    }

    await this.sendVerificationEmail(user.id, user.email);
    return { message: RESEND_VERIFY_MESSAGE };
  }

  /**
   * Always returns success for valid emails (no enumeration).
   * Sends mail only when the user has a password.
   */
  async forgotPassword(email: string): Promise<{ message: string }> {
    const normalized = email.toLowerCase();
    const message =
      'If an account with that email exists, a reset link has been sent.';

    const user = await this.prisma.user.findUnique({
      where: { email: normalized },
      select: { id: true, email: true, passwordHash: true },
    });

    if (!user?.passwordHash) {
      return { message };
    }

    if (!this.mail.isConfigured()) {
      throw new ServiceUnavailableException(
        'Email is not configured. Set MAIL_HOST (and related MAIL_* vars).',
      );
    }

    const rawToken = randomBytes(RESET_TOKEN_BYTES).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    await this.prisma.passwordResetToken.create({
      data: {
        tokenHash,
        userId: user.id,
        expiresAt,
      },
    });

    const frontendOrigin =
      this.config.get<string>('app.frontendOrigin') ?? 'http://localhost:3000';
    const resetUrl = `${frontendOrigin}/auth/reset-password?token=${rawToken}`;

    await this.mail.sendPasswordReset(user.email, resetUrl);
    return { message };
  }

  async resetPassword(rawToken: string, password: string): Promise<{ message: string }> {
    const tokenHash = this.hashToken(rawToken);

    const stored = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });

    if (!stored || stored.usedAt || stored.expiresAt < new Date()) {
      throw new BadRequestException('Invalid or expired reset token');
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: stored.userId },
        data: { passwordHash },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: stored.id },
        data: { usedAt: new Date() },
      }),
      // Invalidate other unused reset tokens for this user
      this.prisma.passwordResetToken.updateMany({
        where: {
          userId: stored.userId,
          usedAt: null,
          id: { not: stored.id },
        },
        data: { usedAt: new Date() },
      }),
      // Force re-login after password change
      this.prisma.refreshToken.updateMany({
        where: { userId: stored.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    return { message: 'Password updated. You can sign in with your new password.' };
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
   * Three-step check — not found / revoked / expired.
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

  private async sendVerificationEmail(
    userId: string,
    email: string,
  ): Promise<void> {
    const rawToken = randomBytes(VERIFY_TOKEN_BYTES).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    const expiresAt = new Date(Date.now() + VERIFY_TOKEN_TTL_MS);

    // Invalidate previous unused tokens so only the latest link works.
    await this.prisma.emailVerificationToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: new Date() },
    });

    await this.prisma.emailVerificationToken.create({
      data: {
        tokenHash,
        userId,
        expiresAt,
      },
    });

    const frontendOrigin =
      this.config.get<string>('app.frontendOrigin') ?? 'http://localhost:3000';
    const verifyUrl = `${frontendOrigin}/auth/verify-email?token=${rawToken}`;

    // Await send: Resend HTTPS is fast; local SMTP has connection timeouts.
    // Railway Hobby blocks outbound SMTP — use RESEND_API_KEY there.
    await this.mail.sendEmailVerification(email, verifyUrl);
  }

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

    const accessToken = this.jwt.sign(
      { sub: user.id, email: user.email },
      {
        secret: this.config.get<string>('jwt.accessSecret'),
        expiresIn: this.config.get<string>(
          'jwt.accessExpiresIn',
        ) as `${number}m`,
      },
    );

    // Trade-off: return empty refreshToken for grace path — middleware only
    // needs accessToken; BFF client refresh always starts from a live cookie.
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
