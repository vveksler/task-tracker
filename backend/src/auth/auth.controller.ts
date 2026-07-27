import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import type { JwtPayload } from '../common/types/jwt-payload';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { GoogleAuthDto } from './dto/google-auth.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';

const REFRESH_COOKIE = 'refresh_token';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register a new user (sends email verification; no session yet)',
  })
  async register(@Body() dto: RegisterDto) {
    return this.authService.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with email and password' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(dto);
    this.setRefreshCookie(res, result.refreshToken);
    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      user: result.user,
    };
  }

  @Public()
  @Post('google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login or register with a Google OAuth authorization code',
  })
  async google(
    @Body() dto: GoogleAuthDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.loginWithGoogle(dto.code);
    this.setRefreshCookie(res, result.refreshToken);
    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      user: result.user,
    };
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm email and issue a session' })
  async verifyEmail(
    @Body() dto: VerifyEmailDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.verifyEmail(dto.token);
    this.setRefreshCookie(res, result.refreshToken);
    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      user: result.user,
    };
  }

  @Public()
  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Resend email verification link' })
  async resendVerification(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerification(dto.email);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Request a password reset email' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto.email);
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set a new password using a reset token' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto.token, dto.password);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Refresh access token using httpOnly cookie or body token',
  })
  async refresh(
    @Req() req: Request,
    @Body() body: { refreshToken?: string },
    @Res({ passthrough: true }) res: Response,
  ) {
    const rawToken =
      body?.refreshToken ??
      (req.cookies?.[REFRESH_COOKIE] as string | undefined);

    if (!rawToken) {
      throw new UnauthorizedException('No refresh token provided');
    }

    const result = await this.authService.refresh(rawToken);

    // Grace period responses return empty refreshToken — don't overwrite cookie
    if (result.refreshToken) {
      this.setRefreshCookie(res, result.refreshToken);
    }

    return {
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      user: result.user,
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout — revoke refresh token and clear cookie' })
  async logout(
    @Req() req: Request,
    @Body() body: { refreshToken?: string },
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() _user: JwtPayload,
  ) {
    const rawToken =
      body?.refreshToken ??
      (req.cookies?.[REFRESH_COOKIE] as string | undefined);

    if (rawToken) {
      await this.authService.logout(rawToken);
    }

    res.clearCookie(REFRESH_COOKIE, {
      httpOnly: true,
      secure: this.isProduction(),
      sameSite: 'lax',
      path: '/',
    });

    return { message: 'Logged out' };
  }

  private setRefreshCookie(res: Response, token: string): void {
    // Backend still sets its own cookie for direct-API consumers (Swagger, tests).
    // In production with BFF, the Next.js API Routes manage cookies on the
    // frontend domain — these backend cookies are harmless but not used.
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      secure: this.isProduction(),
      sameSite: 'lax',
      path: '/',
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });
  }

  private isProduction(): boolean {
    return this.config.get<string>('app.nodeEnv') === 'production';
  }
}
