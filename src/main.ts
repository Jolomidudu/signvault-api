import 'dotenv/config';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { GlobalExceptionFilter } from './common/filters/http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);
  const frontendUrl = configService.get<string>('FRONTEND_URL') ?? 'https://signvaulty.vercel.app,http://localhost:3002';
  const frontendOrigin = new URL(frontendUrl).origin;

  app.use(helmet());
  app.use(cookieParser());
  app.use(
    cors({
      origin: frontendOrigin,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  );
  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.useGlobalFilters(new GlobalExceptionFilter());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('SignVault API')
    .setDescription(
      'API for managing visual signature designs and rendered assets. Native/programmatic auth returns refresh tokens in JSON; browser auth uses HttpOnly refresh cookies. SVG and PNG assets are not cryptographic digital signatures.',
    )
    .setVersion('1.0')
    .addCookieAuth(
      'signvault_refresh',
      { type: 'apiKey', in: 'cookie', name: 'signvault_refresh' },
      'webRefreshCookie',
    )
    .addServer(`/api/v${configService.get<string>('API_VERSION') ?? '1'}`)
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, swaggerDocument);

  const port = Number(configService.get<string>('PORT') ?? 4000);
  await app.listen(port);
}
bootstrap();
