import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { SignatureSvgRenderer } from './rendering/signature-svg.renderer';
import { SignatureAssetsService } from './signature-assets.service';
import { SignaturesController } from './signatures.controller';
import { SignaturesService } from './signatures.service';
import { SignatureVersionsController } from './signature-versions.controller';
import { SignatureVersionsService } from './signature-versions.service';

@Module({
  imports: [PrismaModule, StorageModule],
  controllers: [SignaturesController, SignatureVersionsController],
  providers: [SignaturesService, SignatureVersionsService, SignatureAssetsService, SignatureSvgRenderer],
  exports: [SignaturesService, SignatureVersionsService, SignatureAssetsService],
})
export class SignaturesModule {}
