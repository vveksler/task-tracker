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
  passwordHash: '', // set per test
  name: 'Test User',
};

const mockConfig: Record<string, string> = {
  'jwt.accessSecret': 'test-access-secret',
  'jwt.accessExpiresIn': '15m',
  'jwt.refreshSecret': 'test-refresh-secret',
  'jwt.refreshExpiresIn': '7d',
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
      findFirst: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let jwtService: JwtService;

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
      refreshToken: {
        create: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
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
    jwtService = module.get(JwtService);
  });

  describe('register', () => {
    it('should create a user and return token pair', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({
        id: mockUser.id,
        email: mockUser.email,
      });
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt-1' });

      const result = await service.register({
        email: mockUser.email,
        password: 'password123',
        name: mockUser.name,
      });

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      expect(prisma.user.create).toHaveBeenCalledTimes(1);

      const createCall = prisma.user.create.mock.calls[0]![0]!;
      expect(createCall.data.email).toBe(mockUser.email);
      expect(createCall.data.passwordHash).not.toBe('password123');
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
    it('should return token pair for valid credentials', async () => {
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
      expect(result.refreshToken).toBeDefined();
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
    it('should return new token pair for valid refresh token', async () => {
      const rawToken = jwtService.sign(
        { sub: mockUser.id, email: mockUser.email },
        { secret: mockConfig['jwt.refreshSecret'] },
      );

      prisma.refreshToken.findFirst.mockResolvedValue({
        id: 'rt-1',
        tokenHash: hashToken(rawToken),
        userId: mockUser.id,
        revokedAt: null,
      });
      prisma.refreshToken.update.mockResolvedValue({});
      prisma.refreshToken.create.mockResolvedValue({ id: 'rt-2' });

      const result = await service.refresh(rawToken);

      expect(result.accessToken).toBeDefined();
      expect(result.refreshToken).toBeDefined();
      // Old token should be revoked (rotation)
      expect(prisma.refreshToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'rt-1' },
          data: { revokedAt: expect.any(Date) },
        }),
      );
    });

    /**
     * HUNT FOR (Phase 1): Refresh token replay after logout.
     *
     * Scenario: user logs out (token revoked in DB), then an attacker
     * tries to reuse the same refresh token. The service must return 401,
     * not a fresh token pair.
     */
    it('should reject a revoked refresh token (replay after logout)', async () => {
      const rawToken = jwtService.sign(
        { sub: mockUser.id, email: mockUser.email },
        { secret: mockConfig['jwt.refreshSecret'] },
      );

      // Simulate: token exists in DB but revokedAt is set (logged out).
      // findFirst with revokedAt: null will return null.
      prisma.refreshToken.findFirst.mockResolvedValue(null);

      await expect(service.refresh(rawToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should reject an expired refresh token', async () => {
      const rawToken = jwtService.sign(
        { sub: mockUser.id, email: mockUser.email },
        { secret: mockConfig['jwt.refreshSecret'], expiresIn: '0s' },
      );

      // Wait a tick for the token to expire
      await new Promise((resolve) => setTimeout(resolve, 1100));

      await expect(service.refresh(rawToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });
  });

  describe('logout', () => {
    it('should revoke the refresh token in DB', async () => {
      const rawToken = jwtService.sign(
        { sub: mockUser.id, email: mockUser.email },
        { secret: mockConfig['jwt.refreshSecret'] },
      );

      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      await service.logout(rawToken);

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: {
          tokenHash: hashToken(rawToken),
          userId: mockUser.id,
          revokedAt: null,
        },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('should not throw for an invalid token', async () => {
      await expect(service.logout('invalid-token')).resolves.toBeUndefined();
    });
  });
});
