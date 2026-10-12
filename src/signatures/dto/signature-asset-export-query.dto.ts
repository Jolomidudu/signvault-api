import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsInt, Max, Min } from 'class-validator';

export class SignatureAssetExportQueryDto {
  @ApiPropertyOptional({ enum: ['svg', 'png'], default: 'svg' })
  @IsIn(['svg', 'png'])
  format: 'svg' | 'png' = 'svg';

  @ApiPropertyOptional({ enum: [1, 2, 3], default: 1, description: 'PNG scale; ignored for SVG.' })
  @Transform(({ value }) => (value === undefined ? 1 : Number(value)))
  @IsInt()
  @Min(1)
  @Max(3)
  scale = 1;
}