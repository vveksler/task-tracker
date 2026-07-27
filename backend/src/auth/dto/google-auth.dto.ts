import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class GoogleAuthDto {
  @ApiProperty({ description: 'Authorization code from Google OAuth callback' })
  @IsString()
  @MinLength(1)
  code!: string;
}
