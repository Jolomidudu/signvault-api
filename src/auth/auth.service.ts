import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AccountStatus, type User } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomBytes, createHash } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { LogoutDto } from './dto/logout.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';

type AuditEventName =
  | 'USER_CREATED'
  | 'USER_LOGIN'
  | 'USER_LOGOUT'
  | 'USER_LOGIN_FAILED'
  | 'USER_PASSWORD_RESET'
  | 'USER_EMAIL_VERIFIED'
  | 'USER_REFRESH_TOKEN_ROTATED';

export type AuthenticatedResponse = {
  user: ReturnType<UsersService['toPublicUser']>;
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: string;
};

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
  ) {}

  private normalizeEmail(email: string) {
    return email.trim().toLowerCase();
  }

  private validatePassword(password: string) {
    if (!password || password.trim().length < 8) {
      throw new BadRequestException('Password must be at least 8 characters long.');
    }
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private parseDurationToMs(value: string, fallbackMs: number) {
    const trimmed = value.trim().toLowerCase();
    const match = /^([0-9]+)([smhd])?$/.exec(trimmed);

    if (!match) {
      return fallbackMs;
    }

    const amount = Number(match[1]);
    const unit = match[2] ?? 'm';

    const lookup: Record<string, number> = {
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };

    return amount * (lookup[unit] ?? lookup.m);
  }

  private toSafeUser(user: Partial<User> & { role?: string }) {
    return this.usersService.toPublicUser(user);
  }

  private async recordAudit(
    userId: string | null,
    event: AuditEventName,
    metadata: Record<string, unknown> = {},
    ipAddress?: string,
    userAgent?: string,
  ) {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId,
          event,
          metadata: metadata as never,
          ipAddress: ipAddress ?? null,
          userAgent: userAgent ?? null,
        },
      });
    } catch {
      // Audit logging must never block authentication or expose sensitive errors.
    }
  }

  private async issueTokens(user: User, ipAddress?: string, userAgent?: string): Promise<AuthenticatedResponse> {
    const accessSecret = this.configService.get<string>('JWT_ACCESS_SECRET') ?? 'development-access-secret';
    const accessExpiry = this.configService.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m';
    const refreshExpiry = this.configService.get<string>('JWT_REFRESH_EXPIRES_IN') ?? '7d';

    const accessToken = await this.jwtService.signAsync(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
      },
      {
        secret: accessSecret,
        expiresIn: Number(accessExpiry) || 900,
      },
    );

    const refreshTokenValue = randomBytes(32).toString('hex');
    const refreshTokenHash = this.hashToken(refreshTokenValue);
    const refreshExpiresAt = new Date(Date.now() + this.parseDurationToMs(refreshExpiry, 7 * 24 * 60 * 60 * 1000));

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: refreshTokenHash,
        expiresAt: refreshExpiresAt,
      },
    });

    await this.recordAudit(user.id, 'USER_LOGIN', { ipAddress, userAgent }, ipAddress, userAgent);

    return {
      user: this.toSafeUser(user),
      accessToken,
      refreshToken: refreshTokenValue,
      refreshExpiresAt: refreshExpiresAt.toISOString(),
    };
  }

  async register(dto: RegisterDto, ipAddress?: string, userAgent?: string): Promise<AuthenticatedResponse> {
    const email = this.normalizeEmail(dto.email);
    const existingUser = await this.prisma.user.findUnique({ where: { email } });

    if (existingUser) {
      throw new BadRequestException('User with this email already exists.');
    }

    this.validatePassword(dto.password);

    const displayName = `${dto.firstName.trim()} ${dto.lastName.trim()}`.trim();
    const passwordHash = await argon2.hash(dto.password);

    const user = await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        displayName,
        accountStatus: 'PENDING_VERIFICATION',
        role: 'USER',
      },
    });

    await this.recordAudit(user.id, 'USER_CREATED', { createdVia: 'register' }, ipAddress, userAgent);

    const verificationTokenValue = randomBytes(32).toString('hex');
    const verificationTokenHash = this.hashToken(verificationTokenValue);
    const verificationExpiresAt = new Date(Date.now() + this.parseDurationToMs('24h', 24 * 60 * 60 * 1000));

    await this.prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash: verificationTokenHash,
        expiresAt: verificationExpiresAt,
      },
    });

    return this.issueTokens(user, ipAddress, userAgent);
  }

  async login(dto: LoginDto, ipAddress?: string, userAgent?: string): Promise<AuthenticatedResponse> {
    const email = this.normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      await this.recordAudit(null, 'USER_LOGIN_FAILED', { reason: 'invalid_credentials', email }, ipAddress, userAgent);
      throw new UnauthorizedException('Invalid email or password.');
    }

    const isPasswordValid = await argon2.verify(user.passwordHash, dto.password);

    if (!isPasswordValid) {
      await this.recordAudit(user.id, 'USER_LOGIN_FAILED', { reason: 'invalid_password' }, ipAddress, userAgent);
      throw new UnauthorizedException('Invalid email or password.');
    }

    await this.usersService.ensureAccountAllowed(user);

    return this.issueTokens(user, ipAddress, userAgent);
  }

  async refresh(dto: RefreshTokenDto, ipAddress?: string, userAgent?: string) {
    if (!dto?.refreshToken) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    const tokenHash = this.hashToken(dto.refreshToken);
    const validRefreshToken = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });

    if (!validRefreshToken || validRefreshToken.revokedAt || validRefreshToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired refresh token.');
    }

    const user = await this.prisma.user.findUnique({ where: { id: validRefreshToken.userId } });

    if (!user) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    await this.usersService.ensureAccountAllowed(user);

    await this.prisma.refreshToken.update({
      where: { id: validRefreshToken.id },
      data: { revokedAt: new Date() },
    });

    const tokens = await this.issueTokens(user, ipAddress, userAgent);
    await this.recordAudit(user.id, 'USER_REFRESH_TOKEN_ROTATED', { rotated: true }, ipAddress, userAgent);

    return tokens;
  }

  async logout(userId: string, dto?: LogoutDto, ipAddress?: string, userAgent?: string) {
    if (dto?.refreshToken) {
      const tokenHash = this.hashToken(dto.refreshToken);
      const refreshToken = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

      if (refreshToken) {
        await this.prisma.refreshToken.update({
          where: { id: refreshToken.id },
          data: { revokedAt: new Date() },
        });
      }

      await this.recordAudit(userId, 'USER_LOGOUT', { revokedVia: 'specific_token' }, ipAddress, userAgent);
      return { success: true, message: 'Logged out successfully.' };
    }

    await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    await this.recordAudit(userId, 'USER_LOGOUT', { revokedVia: 'all_tokens' }, ipAddress, userAgent);

    return { success: true, message: 'Logged out successfully.' };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      throw new UnauthorizedException('User not found.');
    }

    return this.toSafeUser(user);
  }

  async forgotPassword(dto: ForgotPasswordDto) {
    const email = this.normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      return {
        message: 'If an account exists for that email, password reset instructions will be sent.',
      };
    }

    const tokenValue = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(tokenValue);
    const expiry = new Date(Date.now() + this.parseDurationToMs('1h', 60 * 60 * 1000));

    await this.prisma.passwordResetToken.updateMany({
      where: {
        userId: user.id,
        revokedAt: null,
        usedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt: expiry,
      },
    });

    return {
      message: 'If an account exists for that email, password reset instructions will be sent.',
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const tokenHash = this.hashToken(dto.token);
    const tokenRecord = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash },
    });

    if (!tokenRecord || tokenRecord.revokedAt || tokenRecord.usedAt || tokenRecord.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired reset token.');
    }

    this.validatePassword(dto.password);

    const user = await this.prisma.user.findUnique({ where: { id: tokenRecord.userId } });

    if (!user) {
      throw new UnauthorizedException('Invalid or expired reset token.');
    }

    const passwordHash = await argon2.hash(dto.password);

    await this.prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
    });

    await this.prisma.passwordResetToken.update({
      where: { id: tokenRecord.id },
      data: { usedAt: new Date(), revokedAt: new Date() },
    });

    await this.prisma.refreshToken.updateMany({
      where: {
        userId: user.id,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    await this.recordAudit(user.id, 'USER_PASSWORD_RESET', { tokenUsed: true });

    return { success: true, message: 'Password reset successfully.' };
  }

  async verifyEmail(dto: VerifyEmailDto) {
    const tokenHash = this.hashToken(dto.token);
    const tokenRecord = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash },
    });

    if (!tokenRecord || tokenRecord.revokedAt || tokenRecord.usedAt || tokenRecord.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired verification token.');
    }

    const user = await this.prisma.user.findUnique({ where: { id: tokenRecord.userId } });

    if (!user) {
      throw new UnauthorizedException('Invalid or expired verification token.');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        emailVerified: true,
        accountStatus: AccountStatus.ACTIVE,
      },
    });

    await this.prisma.emailVerificationToken.update({
      where: { id: tokenRecord.id },
      data: { usedAt: new Date(), revokedAt: new Date() },
    });

    await this.recordAudit(user.id, 'USER_EMAIL_VERIFIED', { verified: true });

    return { success: true, message: 'Email verified successfully.' };
  }

  async resendVerification(dto: ResendVerificationDto) {
    const email = this.normalizeEmail(dto.email);
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || user.emailVerified) {
      return {
        message: 'If an account exists for that email, verification instructions will be sent.',
      };
    }

    const expiresAt = new Date(Date.now() + this.parseDurationToMs('24h', 24 * 60 * 60 * 1000));
    const tokenValue = randomBytes(32).toString('hex');
    const tokenHash = this.hashToken(tokenValue);

    await this.prisma.emailVerificationToken.updateMany({
      where: {
        userId: user.id,
        revokedAt: null,
        usedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    await this.prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    return {
      message: 'If an account exists for that email, verification instructions will be sent.',
    };
  }
}
