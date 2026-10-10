import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SignaturesController } from './signatures.controller';
import { SignaturesService } from './signatures.service';
import { SignatureVersionsController } from './signature-versions.controller';
import { SignatureVersionsService } from './signature-versions.service';

@Module({
  imports: [PrismaModule],
  controllers: [SignaturesController, SignatureVersionsController],
  providers: [SignaturesService, SignatureVersionsService],
  exports: [SignaturesService, SignatureVersionsService],
})
export class SignaturesModule {}
