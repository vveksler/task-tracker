import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ description: 'Raw token from the reset email link' })
  @IsString()
  @MinLength(1)
  token!: string;

  @ApiProperty({ example: 'newStrongP@ss1' })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
