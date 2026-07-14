import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength, MaxLength } from 'class-validator';

export class UpdateWorkspaceDto {
  @ApiProperty({ example: 'Renamed Team' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;
}
