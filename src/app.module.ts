import 'dotenv/config';
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { SignaturesModule } from './signatures/signatures.module';
import { SigningDomainModule } from './signing/signing-domain.module';
import { UsersModule } from './users/users.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local'],
    }),
    PrismaModule,
    HealthModule,
    UsersModule,
    AuthModule,
    SignaturesModule,
    SigningDomainModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
