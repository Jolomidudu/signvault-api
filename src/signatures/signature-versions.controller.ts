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
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateSignatureVersionDto } from './dto/create-signature-version.dto';
import { ListSignatureVersionsQueryDto } from './dto/list-signature-versions-query.dto';
import { SignatureAssetExportQueryDto } from './dto/signature-asset-export-query.dto';
import { SignatureAssetsService } from './signature-assets.service';
import { SignatureVersionsService } from './signature-versions.service';

@ApiTags('Signature Versions')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('signatures/:signatureId/versions')
export class SignatureVersionsController {
  constructor(
    private readonly versionsService: SignatureVersionsService,
    private readonly assetsService: SignatureAssetsService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create an immutable designer version for an owned signature' })
  @ApiCreatedResponse({ description: 'The created signature version.' })
  @ApiBadRequestResponse({ description: 'The designer data or request DTO is invalid.' })
  @ApiUnauthorizedResponse({ description: 'Authentication is missing or invalid.' })
  @ApiNotFoundResponse({ description: 'The signature does not exist or is not owned by the user.' })
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
  @ApiOkResponse({ description: 'The paginated signature version history.' })
  @ApiBadRequestResponse({ description: 'Pagination query parameters are invalid.' })
  @ApiUnauthorizedResponse({ description: 'Authentication is missing or invalid.' })
  @ApiNotFoundResponse({ description: 'The signature does not exist or is not owned by the user.' })
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
  @ApiOkResponse({ description: 'The requested signature version.' })
  @ApiUnauthorizedResponse({ description: 'Authentication is missing or invalid.' })
  @ApiNotFoundResponse({ description: 'The signature or its version does not exist for this user.' })
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
  @ApiCreatedResponse({ description: 'The new version copied from the source designer data.' })
  @ApiUnauthorizedResponse({ description: 'Authentication is missing or invalid.' })
  @ApiNotFoundResponse({ description: 'The signature or an unarchived source version was not found.' })
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
  @ApiOkResponse({ description: 'The selected signature version.' })
  @ApiUnauthorizedResponse({ description: 'Authentication is missing or invalid.' })
  @ApiNotFoundResponse({ description: 'The signature or an unarchived version was not found.' })
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
  @ApiOkResponse({ description: 'The archived signature version.' })
  @ApiUnauthorizedResponse({ description: 'Authentication is missing or invalid.' })
  @ApiNotFoundResponse({ description: 'The signature or version does not exist for this user.' })
  @ApiConflictResponse({ description: 'The signature version is already archived.' })
  @ApiParam({ name: 'signatureId', description: 'Parent signature UUID' })
  @ApiParam({ name: 'versionId', description: 'Signature version UUID' })
  archive(
    @CurrentUser() user: { id: string },
    @Param('signatureId') signatureId: string,
    @Param('versionId') versionId: string,
  ) {
    return this.versionsService.archive(user.id, signatureId, versionId);
  }

  @Post(':versionId/render')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Render and store the canonical SVG for a saved signature version' })
  @ApiOkResponse({ description: 'Safe asset metadata; internal object keys are not exposed.' })
  @ApiBadRequestResponse({ description: 'The route parameters are invalid.' })
  @ApiUnauthorizedResponse({ description: 'Authentication is missing or invalid.' })
  @ApiNotFoundResponse({ description: 'The signature or version was not found for this user.' })
  @ApiResponse({ status: 500, description: 'The saved design could not be rendered safely.' })
  @ApiResponse({ status: 503, description: 'Private object storage is unavailable.' })
  @ApiParam({ name: 'signatureId', description: 'Parent signature UUID' })
  @ApiParam({ name: 'versionId', description: 'Saved signature version UUID' })
  renderAsset(
    @CurrentUser() user: { id: string },
    @Param('signatureId') signatureId: string,
    @Param('versionId') versionId: string,
  ) {
    return this.assetsService.render(user.id, signatureId, versionId);
  }

  @Get(':versionId/asset')
  @ApiOperation({ summary: 'Retrieve the private canonical SVG for a saved signature version' })
  @ApiProduces('image/svg+xml')
  @ApiOkResponse({ description: 'The canonical SVG asset.', schema: { type: 'string', format: 'binary' } })
  @ApiUnauthorizedResponse({ description: 'Authentication is missing or invalid.' })
  @ApiNotFoundResponse({ description: 'The signature version or its asset was not found.' })
  @ApiResponse({ status: 500, description: 'Stored asset integrity validation failed.' })
  @ApiResponse({ status: 503, description: 'Private object storage is unavailable.' })
  @ApiParam({ name: 'signatureId', description: 'Parent signature UUID' })
  @ApiParam({ name: 'versionId', description: 'Saved signature version UUID' })
  async getAsset(
    @CurrentUser() user: { id: string },
    @Param('signatureId') signatureId: string,
    @Param('versionId') versionId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const asset = await this.assetsService.getAsset(user.id, signatureId, versionId);
    response.set({
      'Content-Type': asset.mimeType,
      'Content-Length': String(asset.size),
      'Content-Disposition': `attachment; filename="${asset.filename}"`,
      'Cache-Control': 'private, max-age=300, must-revalidate',
      ETag: `"${asset.checksum}"`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    return asset.body;
  }

  @Get(':versionId/export')
  @ApiOperation({ summary: 'Download SVG or a bounded transparent PNG derivative' })
  @ApiProduces('image/svg+xml', 'image/png')
  @ApiOkResponse({ description: 'The requested signature image.', schema: { type: 'string', format: 'binary' } })
  @ApiBadRequestResponse({ description: 'The export format or PNG scale is invalid.' })
  @ApiUnauthorizedResponse({ description: 'Authentication is missing or invalid.' })
  @ApiNotFoundResponse({ description: 'The signature version or its canonical SVG was not found.' })
  @ApiResponse({ status: 500, description: 'The requested image could not be generated or verified.' })
  @ApiResponse({ status: 503, description: 'Private object storage is unavailable.' })
  @ApiParam({ name: 'signatureId', description: 'Parent signature UUID' })
  @ApiParam({ name: 'versionId', description: 'Saved signature version UUID' })
  async exportAsset(
    @CurrentUser() user: { id: string },
    @Param('signatureId') signatureId: string,
    @Param('versionId') versionId: string,
    @Query() query: SignatureAssetExportQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const asset = await this.assetsService.export(
      user.id,
      signatureId,
      versionId,
      query.format,
      query.scale,
    );
    response.set({
      'Content-Type': asset.mimeType,
      'Content-Length': String(asset.size),
      'Content-Disposition': `attachment; filename="${asset.filename}"`,
      'Cache-Control': 'private, max-age=300, must-revalidate',
      ETag: `"${asset.checksum}"`,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    });
    return asset.body;
  }
}