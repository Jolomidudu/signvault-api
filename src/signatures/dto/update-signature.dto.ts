import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { SignatureCategory } from '@prisma/client';

export class UpdateSignatureDto {
  @ApiPropertyOptional({ example: 'Updated Professional', maxLength: 160 })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name?: string;

  @ApiPropertyOptional({ enum: SignatureCategory, example: SignatureCategory.BUSINESS })
  @IsOptional()
  @IsEnum(SignatureCategory)
  category?: SignatureCategory;

  @ApiPropertyOptional({ example: '2027-12-31T23:59:59.000Z', nullable: true })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (value === '' ? undefined : value))
  expiresAt?: string | null;
}
