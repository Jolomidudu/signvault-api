import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiTags } from '@nestjs/swagger';
import { SignatureCategory, SignatureStatus } from '@prisma/client';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateSignatureDto } from './dto/create-signature.dto';
import { ListSignaturesQueryDto } from './dto/list-signatures-query.dto';
import { UpdateSignatureDto } from './dto/update-signature.dto';
import { SignaturesService } from './signatures.service';

@ApiTags('Signatures')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
@Controller('signatures')
export class SignaturesController {
  constructor(private readonly signaturesService: SignaturesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new signature profile for the authenticated user' })
  create(@CurrentUser() user: { id: string }, @Body() dto: CreateSignatureDto) {
    return this.signaturesService.create(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List the authenticated user signatures with filtering, search, and pagination' })
  @ApiQuery({ name: 'status', enum: SignatureStatus, required: false })
  @ApiQuery({ name: 'category', enum: SignatureCategory, required: false })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'sort', required: false, enum: ['createdAt', 'updatedAt', 'name', 'category'] })
  @ApiQuery({ name: 'order', required: false, enum: ['asc', 'desc'] })
  list(@CurrentUser() user: { id: string }, @Query() query: ListSignaturesQueryDto) {
    return this.signaturesService.list(user.id, query);
  }

  @Get('summary')
  @ApiOperation({ summary: 'Return the authenticated user vault summary and remaining capacity' })
  summary(@CurrentUser() user: { id: string }) {
    return this.signaturesService.summary(user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single signature owned by the authenticated user' })
  @ApiParam({ name: 'id', description: 'Signature UUID' })
  getOne(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.signaturesService.getById(user.id, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update metadata for a signature owned by the authenticated user' })
  @ApiParam({ name: 'id', description: 'Signature UUID' })
  update(@CurrentUser() user: { id: string }, @Param('id') id: string, @Body() dto: UpdateSignatureDto) {
    return this.signaturesService.update(user.id, id, dto);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Archive a signature without deleting its historical record' })
  @ApiParam({ name: 'id', description: 'Signature UUID' })
  archive(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.signaturesService.archive(user.id, id);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Restore an archived signature to active status' })
  @ApiParam({ name: 'id', description: 'Signature UUID' })
  restore(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.signaturesService.restore(user.id, id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete a signature by archiving it and preserving history' })
  @ApiParam({ name: 'id', description: 'Signature UUID' })
  remove(@CurrentUser() user: { id: string }, @Param('id') id: string) {
    return this.signaturesService.remove(user.id, id);
  }
}
