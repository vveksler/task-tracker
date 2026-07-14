import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength } from 'class-validator';

export class UpdateProjectDto {
  @ApiProperty({ example: 'Sprint 2' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;
}
