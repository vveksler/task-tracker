import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { createHash } from 'crypto';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

const mockUser = {
  id: 'user-uuid-1',
  email: 'test@example.com',
  passwordHash: '',
  name: 'Test User',
};

const mockConfig: Record<string, string> = {
  'jwt.accessSecret': 'test-access-secret',
  'jwt.accessExpiresIn': '15m',
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
    };
    refreshToken: {
      create: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      deleteMany: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      refreshToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
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
    it('should create a user and return token pair with user data', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: mockUser.id,
        email: mockUser.email,
        name: mockUser.name,
      });
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });

      const result = await service.register({
        email: mockUser.email,
        password: 'password123',
        name: mockUser.name,
      });

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toHaveLength(80);
      expect(result.user).toEqual({
        id: mockUser.id,
        email: mockUser.email,
        name: mockUser.name,
      });
      expect(prisma.user.create).toHaveBeenCalledTimes(1);

      const createCall = prisma.user.create.mock.calls[0]![0]!;
      expect(createCall.data.email).toBe(mockUser.email);
      expect(createCall.data.passwordHash).not.toBe('password123');
    });

    it('should store the SHA-256 hash of refresh token, not the raw value', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: mockUser.id,
        email: mockUser.email,
        name: mockUser.name,
      });
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });

      const result = await service.register({
        email: mockUser.email,
        password: 'password123',
        name: mockUser.name,
      });

      const storedHash =
        prisma.refreshToken.create.mock.calls[0]![0]!.data.tokenHash;
      expect(storedHash).toBe(hashToken(result.refreshToken));
      expect(storedHash).not.toBe(result.refreshToken);
    });

    it('should throw ConflictException if email already exists', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: mockUser.id });

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
    it('should return token pair with user data for valid credentials', async () => {
      const hash = await bcrypt.hash('password123', 10);
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        passwordHash: hash,
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

    it('should throw UnauthorizedException for wrong password', async () => {
      const hash = await bcrypt.hash('password123', 10);
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        passwordHash: hash,
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
  });

  describe('refresh', () => {
    const rawToken = 'a'.repeat(80); // simulates a 40-byte hex token

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

    /**
     * HUNT FOR (Phase 1): Refresh token replay after logout.
     *
     * Scenario: user logs out (revokedAt set, no replacedByHash),
     * then an attacker reuses the token. The three-step check
     * detects revokedAt + no replacement → "Token has been revoked".
     */
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

      await expect(service.refresh(rawToken)).rejects.toThrow(
        'Token expired',
      );
    });

    describe('grace period', () => {
      const replacementRawToken = 'b'.repeat(80);
      const replacementHash = hashToken(replacementRawToken);

      it('should allow reuse of a recently-rotated token within grace period', async () => {
        // First call: findUnique returns the revoked original token
        prisma.refreshToken.findUnique
          .mockResolvedValueOnce({
            id: 'rt-1',
            tokenHash: hashToken(rawToken),
            userId: mockUser.id,
            revokedAt: new Date(Date.now() - 5_000), // 5s ago — within 30s grace
            replacedByHash: replacementHash,
            expiresAt: new Date(Date.now() + 86_400_000),
          })
          // Second call: findUnique returns the live replacement token
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
        // Grace period returns empty refreshToken (caller only needs accessToken)
        expect(result.refreshToken).toBe('');
        expect(result.user.email).toBe(mockUser.email);
      });

      it('should reject a rotated token outside the grace period', async () => {
        prisma.refreshToken.findUnique.mockResolvedValueOnce({
          id: 'rt-1',
          tokenHash: hashToken(rawToken),
          userId: mockUser.id,
          revokedAt: new Date(Date.now() - 60_000), // 60s ago — outside 30s grace
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
            revokedAt: new Date(), // replacement also revoked
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
