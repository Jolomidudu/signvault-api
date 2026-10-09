import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({ example: 'opaque-refresh-token-value' })
  @IsString()
  @IsNotEmpty()
  refreshToken: string;
}
