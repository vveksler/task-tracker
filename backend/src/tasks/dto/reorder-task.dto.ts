import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNumber, IsOptional, IsUUID } from 'class-validator';
import { TaskStatus } from '@prisma/client';

export class ReorderTaskDto {
  @ApiProperty({ enum: TaskStatus, description: 'Target column (status)' })
  @IsEnum(TaskStatus)
  status!: TaskStatus;

  @ApiPropertyOptional({
    description:
      'ID of the task directly above the new position. Null = top of column.',
  })
  @IsUUID()
  @IsOptional()
  afterTaskId?: string | null;

  @ApiPropertyOptional({
    description:
      'ID of the task directly below the new position. Null = bottom of column.',
  })
  @IsUUID()
  @IsOptional()
  beforeTaskId?: string | null;

  @ApiPropertyOptional({
    description:
      'Explicit order value. If provided, afterTaskId/beforeTaskId are ignored.',
  })
  @IsNumber()
  @IsOptional()
  order?: number;
}
