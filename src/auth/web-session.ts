import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request } from 'express';

export const WEB_REFRESH_COOKIE_NAME = 'signvault_refresh';
export const WEB_AUTH_COOKIE_PATH = '/api/v1/auth/web';

export function getWebRefreshCookieOptions(configService: ConfigService): CookieOptions {
  const configuredSameSite = configService.get<string>('AUTH_COOKIE_SAME_SITE')?.toLowerCase();
  const sameSite = configuredSameSite || 'lax';

  if (!['lax', 'strict', 'none'].includes(sameSite)) {
    throw new Error('AUTH_COOKIE_SAME_SITE must be lax, strict, or none.');
  }

  const production = configService.get<string>('NODE_ENV') === 'production';
  const secure = production || sameSite === 'none' || configService.get<string>('AUTH_COOKIE_SECURE') === 'true';
  const domain = configService.get<string>('AUTH_COOKIE_DOMAIN')?.trim();

  return {
    httpOnly: true,
    secure,
    sameSite: sameSite as CookieOptions['sameSite'],
    path: WEB_AUTH_COOKIE_PATH,
    ...(domain ? { domain } : {}),
  };
}

export function assertWebOrigin(request: Request, configService: ConfigService) {
  const origin = request.get('origin');
  const frontendUrl = configService.get<string>('FRONTEND_URL') ?? 'http://localhost:3000';

  if (!origin || origin === 'null' || new URL(origin).origin !== new URL(frontendUrl).origin) {
    throw new ForbiddenException('Origin is not allowed.');
  }
}