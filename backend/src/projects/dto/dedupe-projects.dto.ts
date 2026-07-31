import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class DedupeProjectsDto {
  @ApiPropertyOptional({
    description:
      'If set, only dedupe projects with this exact name; otherwise all duplicate names',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({
    enum: ['oldest', 'newest'],
    default: 'oldest',
    description: 'Which project to keep for each duplicate name',
  })
  @IsOptional()
  @IsIn(['oldest', 'newest'])
  keep?: 'oldest' | 'newest' = 'oldest';
}
