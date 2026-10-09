import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class LogoutDto {
  @ApiPropertyOptional({ example: 'opaque-refresh-token-value' })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
