import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';

const mockUser = {
  id: 'user-uuid-1',
  email: 'test@example.com',
  passwordHash: '',
  name: 'Test User',
};

const mockConfig: Record<string, string> = {
  'jwt.accessSecret': 'test-access-secret',
  'jwt.accessExpiresIn': '15m',
  'app.frontendOrigin': 'http://localhost:3000',
  'google.clientId': 'google-client-id',
  'google.clientSecret': 'google-client-secret',
  'google.callbackUrl': 'http://localhost:3000/api/auth/google/callback',
};

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    refreshToken: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
    };
    passwordResetToken: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    emailVerificationToken: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let mail: {
    isConfigured: jest.Mock;
    sendPasswordReset: jest.Mock;
    sendEmailVerification: jest.Mock;
    enqueue: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      refreshToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      passwordResetToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      emailVerificationToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      $transaction: jest.fn(async (ops: unknown) => ops),
    };

    mail = {
      isConfigured: jest.fn().mockReturnValue(true),
      sendPasswordReset: jest.fn().mockResolvedValue(undefined),
      sendEmailVerification: jest.fn().mockResolvedValue(undefined),
      // Mirror production: run the queued send immediately in tests.
      enqueue: jest.fn((send: () => Promise<void>) => {
        void send();
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: MailService, useValue: mail },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => mockConfig[key]),
          },
        },
        {
          provide: JwtService,
          useValue: new JwtService({}),
        },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  describe('register', () => {
    it('should create an unverified user and send verification email without tokens', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: mockUser.id,
        email: mockUser.email,
      });
      prisma.emailVerificationToken.create.mockResolvedValue({ id: 'evt-1' });

      const result = await service.register({
        email: mockUser.email,
        password: 'password123',
        name: mockUser.name,
      });

      expect(result.message).toMatch(/confirmation link/i);
      expect(prisma.user.create).toHaveBeenCalledTimes(1);
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
      expect(mail.enqueue).toHaveBeenCalled();
      expect(mail.sendEmailVerification).toHaveBeenCalledWith(
        mockUser.email,
        expect.stringContaining('/auth/verify-email?token='),
      );

      const createCall = prisma.user.create.mock.calls[0]![0]!;
      expect(createCall.data.email).toBe(mockUser.email);
      expect(createCall.data.emailVerifiedAt).toBeNull();
      expect(createCall.data.passwordHash).not.toBe('password123');
    });

    it('should resend verification for an existing unverified email', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: mockUser.id,
        email: mockUser.email,
        emailVerifiedAt: null,
        passwordHash: 'old-hash',
      });
      prisma.user.update.mockResolvedValue({
        id: mockUser.id,
        email: mockUser.email,
      });
      prisma.emailVerificationToken.create.mockResolvedValue({ id: 'evt-2' });

      const result = await service.register({
        email: mockUser.email,
        password: 'password123',
        name: mockUser.name,
      });

      expect(result.message).toMatch(/confirmation link/i);
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.user.update).toHaveBeenCalled();
      expect(mail.sendEmailVerification).toHaveBeenCalled();
    });

    it('should return before SMTP finishes (non-blocking enqueue)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: mockUser.id,
        email: mockUser.email,
      });
      prisma.emailVerificationToken.create.mockResolvedValue({ id: 'evt-1' });
      // Simulate a hung SMTP: enqueue never runs the send callback.
      mail.enqueue.mockImplementation(() => undefined);

      const result = await service.register({
        email: mockUser.email,
        password: 'password123',
        name: mockUser.name,
      });

      expect(result.message).toMatch(/confirmation link/i);
      expect(mail.enqueue).toHaveBeenCalled();
      expect(mail.sendEmailVerification).not.toHaveBeenCalled();
    });

    it('should throw ConflictException if email is already verified', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: mockUser.id,
        email: mockUser.email,
        emailVerifiedAt: new Date(),
        passwordHash: 'hash',
      });

      await expect(
        service.register({
          email: mockUser.email,
          password: 'password123',
          name: mockUser.name,
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('login', () => {
    it('should return token pair with user data for valid verified credentials', async () => {
      const hash = await bcrypt.hash('password123', 10);
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        passwordHash: hash,
        emailVerifiedAt: new Date(),
      });
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });

      const result = await service.login({
        email: mockUser.email,
        password: 'password123',
      });

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toHaveLength(80);
      expect(result.user).toEqual({
        id: mockUser.id,
        email: mockUser.email,
        name: mockUser.name,
      });
    });

    it('should throw UnauthorizedException for unverified email', async () => {
      const hash = await bcrypt.hash('password123', 10);
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        passwordHash: hash,
        emailVerifiedAt: null,
      });

      await expect(
        service.login({ email: mockUser.email, password: 'password123' }),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.refreshToken.create).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedException for wrong password', async () => {
      const hash = await bcrypt.hash('password123', 10);
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        passwordHash: hash,
        emailVerifiedAt: new Date(),
      });

      await expect(
        service.login({ email: mockUser.email, password: 'wrongpass' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should throw UnauthorizedException for non-existent user', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nobody@example.com', password: 'password123' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('should tell Google-only users to use Google sign-in', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        passwordHash: null,
      });

      await expect(
        service.login({ email: mockUser.email, password: 'password123' }),
      ).rejects.toThrow(/Google sign-in/);
    });
  });

  describe('loginWithGoogle', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
      global.fetch = originalFetch;
    });

    it('should create a Google-only user when email is new', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'g-access' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 'google-sub-1',
            email: 'new@example.com',
            verified_email: true,
            name: 'New User',
          }),
        }) as unknown as typeof fetch;

      prisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);
      prisma.user.create.mockResolvedValue({
        id: 'user-new',
        email: 'new@example.com',
        name: 'New User',
        emailVerifiedAt: new Date(),
      });
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });

      const result = await service.loginWithGoogle('auth-code');

      expect(result.user.email).toBe('new@example.com');
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            googleId: 'google-sub-1',
            passwordHash: null,
            emailVerifiedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('should link googleId to an existing email account', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'g-access' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 'google-sub-2',
            email: mockUser.email,
            verified_email: true,
            name: mockUser.name,
          }),
        }) as unknown as typeof fetch;

      prisma.user.findUnique
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: mockUser.id,
          email: mockUser.email,
          name: mockUser.name,
          googleId: null,
          emailVerifiedAt: null,
        });
      prisma.user.update.mockResolvedValue({
        id: mockUser.id,
        email: mockUser.email,
        name: mockUser.name,
        emailVerifiedAt: new Date(),
      });
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });

      const result = await service.loginWithGoogle('auth-code');

      expect(result.user.id).toBe(mockUser.id);
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            googleId: 'google-sub-2',
            emailVerifiedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('should reject unverified Google emails', async () => {
      global.fetch = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: 'g-access' }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            id: 'google-sub-3',
            email: 'x@example.com',
            verified_email: false,
          }),
        }) as unknown as typeof fetch;

      await expect(service.loginWithGoogle('auth-code')).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('verifyEmail / resendVerification', () => {
    it('should verify email and issue tokens for a valid unused token', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue({
        id: 'evt-1',
        tokenHash: hashToken('raw-verify-token'),
        userId: mockUser.id,
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
      });
      prisma.user.findUnique.mockResolvedValue({
        id: mockUser.id,
        email: mockUser.email,
        name: mockUser.name,
        emailVerifiedAt: null,
      });
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });

      const result = await service.verifyEmail('raw-verify-token');

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toHaveLength(80);
      expect(result.user.id).toBe(mockUser.id);
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('should reject expired verification tokens', async () => {
      prisma.emailVerificationToken.findUnique.mockResolvedValue({
        id: 'evt-1',
        tokenHash: hashToken('raw-verify-token'),
        userId: mockUser.id,
        expiresAt: new Date(Date.now() - 1000),
        usedAt: null,
      });

      await expect(service.verifyEmail('raw-verify-token')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should send verification for unverified password users', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: mockUser.id,
        email: mockUser.email,
        passwordHash: 'hash',
        emailVerifiedAt: null,
      });
      prisma.emailVerificationToken.create.mockResolvedValue({ id: 'evt-1' });

      const result = await service.resendVerification(mockUser.email);

      expect(result.message).toMatch(/confirmation link/i);
      expect(mail.sendEmailVerification).toHaveBeenCalled();
    });

    it('should not send for already verified users but still return success', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: mockUser.id,
        email: mockUser.email,
        passwordHash: 'hash',
        emailVerifiedAt: new Date(),
      });

      const result = await service.resendVerification(mockUser.email);

      expect(result.message).toMatch(/confirmation link/i);
      expect(mail.sendEmailVerification).not.toHaveBeenCalled();
    });
  });

  describe('forgotPassword / resetPassword', () => {
    it('should create a reset token and send email for password users', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: mockUser.id,
        email: mockUser.email,
        passwordHash: 'hash',
      });
      prisma.passwordResetToken.create.mockResolvedValue({ id: 'prt-1' });

      const result = await service.forgotPassword(mockUser.email);

      expect(result.message).toMatch(/reset link/i);
      expect(prisma.passwordResetToken.create).toHaveBeenCalled();
      expect(mail.sendPasswordReset).toHaveBeenCalledWith(
        mockUser.email,
        expect.stringContaining('/auth/reset-password?token='),
      );
    });

    it('should not send email for Google-only users but still return success', async () => {
      prisma.user.findUnique.mockResolvedValue({
        id: mockUser.id,
        email: mockUser.email,
        passwordHash: null,
      });

      const result = await service.forgotPassword(mockUser.email);

      expect(result.message).toMatch(/reset link/i);
      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(mail.sendPasswordReset).not.toHaveBeenCalled();
    });

    it('should reset password for a valid unused token', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'prt-1',
        tokenHash: hashToken('raw-reset-token'),
        userId: mockUser.id,
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null,
      });

      const result = await service.resetPassword(
        'raw-reset-token',
        'newPassword1',
      );

      expect(result.message).toMatch(/Password updated/i);
      expect(prisma.$transaction).toHaveBeenCalled();
    });

    it('should reject expired or used reset tokens', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'prt-1',
        tokenHash: hashToken('raw-reset-token'),
        userId: mockUser.id,
        expiresAt: new Date(Date.now() - 1000),
        usedAt: null,
      });

      await expect(
        service.resetPassword('raw-reset-token', 'newPassword1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('refresh', () => {
    const rawToken = 'a'.repeat(80);

    it('should rotate: revoke old token, issue new pair, link via replacedByHash', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        tokenHash: hashToken(rawToken),
        userId: mockUser.id,
        revokedAt: null,
        replacedByHash: null,
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      prisma.refreshToken.update.mockResolvedValue({});
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt-2' });
      prisma.user.findUnique.mockResolvedValue({
        id: mockUser.id,
        email: mockUser.email,
        name: mockUser.name,
      });

      const result = await service.refresh(rawToken);

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toHaveLength(80);
      expect(result.user).toEqual({
        id: mockUser.id,
        email: mockUser.email,
        name: mockUser.name,
      });
      expect(prisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rt-1' },
          data: {
            revokedAt: expect.any(Date),
            replacedByHash: hashToken(result.refreshToken),
          },
        }),
      );
    });

    it('should reject an unknown refresh token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.refresh(rawToken)).rejects.toThrow(
        'Invalid refresh token',
      );
    });

    it('should reject a revoked token without replacedByHash (logout)', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        tokenHash: hashToken(rawToken),
        userId: mockUser.id,
        revokedAt: new Date(),
        replacedByHash: null,
        expiresAt: new Date(Date.now() + 86_400_000),
      });

      await expect(service.refresh(rawToken)).rejects.toThrow(
        'Token has been revoked',
      );
    });

    it('should reject an expired refresh token', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        tokenHash: hashToken(rawToken),
        userId: mockUser.id,
        revokedAt: null,
        replacedByHash: null,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(service.refresh(rawToken)).rejects.toThrow('Token expired');
    });

    describe('grace period', () => {
      const replacementRawToken = 'b'.repeat(80);
      const replacementHash = hashToken(replacementRawToken);

      it('should allow reuse of a recently-rotated token within grace period', async () => {
        prisma.refreshToken.findUnique
          .mockResolvedValueOnce({
            id: 'rt-1',
            tokenHash: hashToken(rawToken),
            userId: mockUser.id,
            revokedAt: new Date(Date.now() - 5_000),
            replacedByHash: replacementHash,
            expiresAt: new Date(Date.now() + 86_400_000),
          })
          .mockResolvedValueOnce({
            id: 'rt-2',
            tokenHash: replacementHash,
            userId: mockUser.id,
            revokedAt: null,
            replacedByHash: null,
            expiresAt: new Date(Date.now() + 86_400_000),
          });

        prisma.user.findUnique.mockResolvedValue({
          id: mockUser.id,
          email: mockUser.email,
          name: mockUser.name,
        });

        const result = await service.refresh(rawToken);

        expect(result.accessToken).toBeDefined();
        expect(result.refreshToken).toBe('');
        expect(result.user.email).toBe(mockUser.email);
      });

      it('should reject a rotated token outside the grace period', async () => {
        prisma.refreshToken.findUnique.mockResolvedValueOnce({
          id: 'rt-1',
          tokenHash: hashToken(rawToken),
          userId: mockUser.id,
          revokedAt: new Date(Date.now() - 60_000),
          replacedByHash: replacementHash,
          expiresAt: new Date(Date.now() + 86_400_000),
        });

        await expect(service.refresh(rawToken)).rejects.toThrow(
          'Token has been revoked',
        );
      });

      it('should reject if the replacement token is also revoked', async () => {
        prisma.refreshToken.findUnique
          .mockResolvedValueOnce({
            id: 'rt-1',
            tokenHash: hashToken(rawToken),
            userId: mockUser.id,
            revokedAt: new Date(Date.now() - 5_000),
            replacedByHash: replacementHash,
            expiresAt: new Date(Date.now() + 86_400_000),
          })
          .mockResolvedValueOnce({
            id: 'rt-2',
            tokenHash: replacementHash,
            userId: mockUser.id,
            revokedAt: new Date(),
            replacedByHash: null,
            expiresAt: new Date(Date.now() + 86_400_000),
          });

        await expect(service.refresh(rawToken)).rejects.toThrow(
          'Token has been revoked',
        );
      });
    });
  });

  describe('logout', () => {
    it('should revoke the refresh token in DB', async () => {
      const rawToken = 'b'.repeat(80);
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      await service.logout(rawToken);

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: {
          tokenHash: hashToken(rawToken),
          revokedAt: null,
        },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('should not throw even if token not found in DB', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.logout('unknown-token')).resolves.toBeUndefined();
    });
  });
});
