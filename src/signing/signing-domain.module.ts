import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SigningDomainService } from './signing-domain.service';

@Module({
  imports: [PrismaModule],
  providers: [SigningDomainService],
  exports: [SigningDomainService],
})
export class SigningDomainModule {}