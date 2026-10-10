import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { SignatureDesignStyle, SignatureDesignDto } from './signature-design.dto';

export class CreateSignatureVersionDto {
  @ApiProperty({ maxLength: 160, example: 'Jolomi Dudu' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  displayText: string;

  @ApiProperty({ enum: SignatureDesignStyle })
  @IsEnum(SignatureDesignStyle)
  style: SignatureDesignStyle;

  @ApiProperty({ type: SignatureDesignDto })
  @ValidateNested()
  @Type(() => SignatureDesignDto)
  design: SignatureDesignDto;
}