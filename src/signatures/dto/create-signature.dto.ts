import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { SignatureCategory } from '@prisma/client';

export class CreateSignatureDto {
  @ApiProperty({ example: 'Professional', maxLength: 160 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name: string;

  @ApiProperty({ enum: SignatureCategory, example: SignatureCategory.PROFESSIONAL })
  @IsEnum(SignatureCategory)
  category: SignatureCategory;

  @ApiProperty({ example: '2027-12-31T23:59:59.000Z', required: false })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => (value === '' ? undefined : value))
  expiresAt?: string;
}
