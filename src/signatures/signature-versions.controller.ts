import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateSignatureVersionDto } from './dto/create-signature-version.dto';
import { ListSignatureVersionsQueryDto } from './dto/list-signature-versions-query.dto';
import { SignatureVersionsService } from './signature-versions.service';

@ApiTags('Signature Versions')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('signatures/:signatureId/versions')
export class SignatureVersionsController {
  constructor(private readonly versionsService: SignatureVersionsService) {}

  @Post()
  @ApiOperation({ summary: 'Create an immutable designer version for an owned signature' })
  @ApiParam({ name: 'signatureId', description: 'Parent signature UUID' })
  create(
    @CurrentUser() user: { id: string },
    @Param('signatureId') signatureId: string,
    @Body() dto: CreateSignatureVersionDto,
  ) {
    return this.versionsService.create(user.id, signatureId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List signature versions, newest version number first' })
  @ApiParam({ name: 'signatureId', description: 'Parent signature UUID' })
  list(
    @CurrentUser() user: { id: string },
    @Param('signatureId') signatureId: string,
    @Query() query: ListSignatureVersionsQueryDto,
  ) {
    return this.versionsService.list(user.id, signatureId, query);
  }

  @Get(':versionId')
  @ApiOperation({ summary: 'Get one version belonging to an owned signature' })
  @ApiParam({ name: 'signatureId', description: 'Parent signature UUID' })
  @ApiParam({ name: 'versionId', description: 'Signature version UUID' })
  getOne(
    @CurrentUser() user: { id: string },
    @Param('signatureId') signatureId: string,
    @Param('versionId') versionId: string,
  ) {
    return this.versionsService.getOne(user.id, signatureId, versionId);
  }

  @Post(':versionId/duplicate')
  @ApiOperation({ summary: 'Create a new immutable version from an existing version' })
  @ApiParam({ name: 'signatureId', description: 'Parent signature UUID' })
  @ApiParam({ name: 'versionId', description: 'Source signature version UUID' })
  duplicate(
    @CurrentUser() user: { id: string },
    @Param('signatureId') signatureId: string,
    @Param('versionId') versionId: string,
  ) {
    return this.versionsService.duplicate(user.id, signatureId, versionId);
  }

  @Put(':versionId/current')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Select an unarchived version as the current signature version' })
  @ApiParam({ name: 'signatureId', description: 'Parent signature UUID' })
  @ApiParam({ name: 'versionId', description: 'Signature version UUID' })
  selectCurrent(
    @CurrentUser() user: { id: string },
    @Param('signatureId') signatureId: string,
    @Param('versionId') versionId: string,
  ) {
    return this.versionsService.selectCurrent(user.id, signatureId, versionId);
  }

  @Post(':versionId/archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Archive a version without deleting its historical record' })
  @ApiParam({ name: 'signatureId', description: 'Parent signature UUID' })
  @ApiParam({ name: 'versionId', description: 'Signature version UUID' })
  archive(
    @CurrentUser() user: { id: string },
    @Param('signatureId') signatureId: string,
    @Param('versionId') versionId: string,
  ) {
    return this.versionsService.archive(user.id, signatureId, versionId);
  }
}