import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsIn, IsNumber, Max, Min } from 'class-validator';

export enum SignatureDesignStyle {
  CLASSIC = 'CLASSIC',
  ELEGANT = 'ELEGANT',
  MODERN = 'MODERN',
  MINIMAL = 'MINIMAL',
}

export enum SignatureFontFamily {
  CLASSIC_SERIF = 'CLASSIC_SERIF',
  ELEGANT_SCRIPT = 'ELEGANT_SCRIPT',
  MODERN_SCRIPT = 'MODERN_SCRIPT',
  MINIMAL_SANS = 'MINIMAL_SANS',
}

export class SignatureDesignDto {
  @ApiProperty({ enum: SignatureFontFamily })
  @IsEnum(SignatureFontFamily)
  fontFamily: SignatureFontFamily;

  @ApiProperty({ minimum: 8, maximum: 120 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(8)
  @Max(120)
  fontSize: number;

  @ApiProperty({ enum: [300, 400, 500, 600, 700] })
  @IsIn([300, 400, 500, 600, 700])
  fontWeight: number;

  @ApiProperty({ minimum: -10, maximum: 20 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-10)
  @Max(20)
  letterSpacing: number;

  @ApiProperty({ minimum: -45, maximum: 45 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-45)
  @Max(45)
  slant: number;

  @ApiProperty({ minimum: -180, maximum: 180 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(-180)
  @Max(180)
  rotation: number;

  @ApiProperty({ minimum: 0.1, maximum: 12 })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.1)
  @Max(12)
  strokeWidth: number;
}