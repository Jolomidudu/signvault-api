import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { SignatureCategory, SignatureStatus } from '@prisma/client';

export class ListSignaturesQueryDto {
  @ApiPropertyOptional({ enum: SignatureStatus })
  @IsOptional()
  @IsEnum(SignatureStatus)
  status?: SignatureStatus;

  @ApiPropertyOptional({ enum: SignatureCategory })
  @IsOptional()
  @IsEnum(SignatureCategory)
  category?: SignatureCategory;

  @ApiPropertyOptional({ example: 'work' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;

  @ApiPropertyOptional({ example: 1, minimum: 1 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ example: 10, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 10;

  @ApiPropertyOptional({ enum: ['createdAt', 'updatedAt', 'name', 'category'], default: 'createdAt' })
  @IsOptional()
  @IsIn(['createdAt', 'updatedAt', 'name', 'category'])
  sort = 'createdAt';

  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order = 'desc';
}
