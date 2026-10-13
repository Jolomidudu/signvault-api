import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { CurrentUser } from './decorators/current-user.decorator';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { LogoutDto } from './dto/logout.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { AuthService } from './auth.service';
import {
  assertWebOrigin,
  getWebRefreshCookieOptions,
  WEB_REFRESH_COOKIE_NAME,
} from './web-session';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  private setWebRefreshCookie(response: Response, tokens: Awaited<ReturnType<AuthService['login']>>) {
    const { refreshToken, refreshExpiresAt, ...payload } = tokens;
    const expiresAt = new Date(refreshExpiresAt);
    const maxAge = Math.max(0, expiresAt.getTime() - Date.now());

    response.cookie(WEB_REFRESH_COOKIE_NAME, refreshToken, {
      ...getWebRefreshCookieOptions(this.configService),
      expires: expiresAt,
      maxAge,
    });

    return payload;
  }

  private requireWebOrigin(request: Request) {
    assertWebOrigin(request, this.configService);
  }

  @Post('web/register')
  @ApiOperation({ summary: 'Register a browser user and set an HttpOnly refresh cookie' })
  async webRegister(
    @Body() dto: RegisterDto,
    @Req() req: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.requireWebOrigin(req);
    const tokens = await this.authService.register(dto, req.ip, req.headers['user-agent']);
    return this.setWebRefreshCookie(response, tokens);
  }

  @Post('web/login')
  @ApiOperation({ summary: 'Browser login; access token is returned in JSON and refresh token in cookie' })
  async webLogin(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.requireWebOrigin(req);
    const tokens = await this.authService.login(dto, req.ip, req.headers['user-agent']);
    return this.setWebRefreshCookie(response, tokens);
  }

  @Post('web/refresh')
  @ApiCookieAuth('webRefreshCookie')
  @ApiOperation({ summary: 'Rotate the browser refresh cookie and return a new access token' })
  async webRefresh(@Req() req: Request, @Res({ passthrough: true }) response: Response) {
    this.requireWebOrigin(req);
    const refreshToken = req.cookies?.[WEB_REFRESH_COOKIE_NAME];
    const tokens = await this.authService.refresh({ refreshToken }, req.ip, req.headers['user-agent']);
    return this.setWebRefreshCookie(response, tokens);
  }

  @Post('web/logout')
  @ApiCookieAuth('webRefreshCookie')
  @ApiOperation({ summary: 'Revoke the browser refresh session and clear its cookie' })
  async webLogout(@Req() req: Request, @Res({ passthrough: true }) response: Response) {
    this.requireWebOrigin(req);
    await this.authService.logoutWeb(
      req.cookies?.[WEB_REFRESH_COOKIE_NAME],
      req.ip,
      req.headers['user-agent'],
    );
    response.clearCookie(WEB_REFRESH_COOKIE_NAME, getWebRefreshCookieOptions(this.configService));
    return { success: true, message: 'Logged out successfully.' };
  }

  @Post('register')
  @ApiOperation({ summary: 'Register a new user' })
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.authService.register(dto, req.ip, req.headers['user-agent']);
  }

  @Post('login')
  @ApiOperation({ summary: 'Log in a user and return access and refresh tokens' })
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto, req.ip, req.headers['user-agent']);
  }

  @Post('refresh')
  @ApiOperation({ summary: 'Refresh an access token using a valid refresh token' })
  async refresh(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    return this.authService.refresh(dto, req.ip, req.headers['user-agent']);
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Revoke the active refresh token session' })
  async logout(@Body() dto: LogoutDto, @CurrentUser() user: { id: string }, @Req() req: Request) {
    return this.authService.logout(user.id, dto, req.ip, req.headers['user-agent']);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the authenticated user profile' })
  async me(@CurrentUser() user: { id: string }) {
    return this.authService.me(user.id);
  }

  @Post('forgot-password')
  @ApiOperation({ summary: 'Request a password reset' })
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.authService.forgotPassword(dto);
  }

  @Post('reset-password')
  @ApiOperation({ summary: 'Reset a user password using a valid reset token' })
  async resetPassword(@Body() dto: ResetPasswordDto) {
    return this.authService.resetPassword(dto);
  }

  @Post('verify-email')
  @ApiOperation({ summary: 'Verify a user email using a token' })
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto);
  }

  @Post('resend-verification')
  @ApiOperation({ summary: 'Resend email verification instructions' })
  async resendVerification(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerification(dto);
  }
}
