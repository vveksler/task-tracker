import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TaskStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
  Validate,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';

@ValidatorConstraint({ name: 'atLeastOneFilterField', async: false })
export class AtLeastOneFilterFieldConstraint
  implements ValidatorConstraintInterface
{
  validate(filter: BulkTasksFilterDto | undefined): boolean {
    if (!filter || typeof filter !== 'object') return false;
    return Boolean(
      filter.titleContains?.trim() ||
        filter.descriptionContains?.trim() ||
        filter.assigneeNameContains?.trim() ||
        (filter.statusIn && filter.statusIn.length > 0) ||
        filter.projectId?.trim() ||
        filter.projectName?.trim(),
    );
  }

  defaultMessage(_args: ValidationArguments): string {
    return (
      'filter must include at least one of: titleContains, descriptionContains, ' +
      'assigneeNameContains, statusIn, projectId, projectName'
    );
  }
}

/** Shared filter for bulk-update and bulk-delete. */
export class BulkTasksFilterDto {
  @ApiPropertyOptional({ example: 'auth' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  titleContains?: string;

  @ApiPropertyOptional({ example: 'login' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  descriptionContains?: string;

  @ApiPropertyOptional({
    example: 'Alice',
    description: 'Case-insensitive match against assignee name or email',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  assigneeNameContains?: string;

  @ApiPropertyOptional({ enum: TaskStatus, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsEnum(TaskStatus, { each: true })
  statusIn?: TaskStatus[];

  @ApiPropertyOptional({
    description: 'Limit to tasks in this project (must belong to workspace)',
  })
  @IsOptional()
  @IsUUID()
  projectId?: string;

  @ApiPropertyOptional({
    example: 'Auth & Security',
    description:
      'Case-insensitive exact project name in this workspace (resolved server-side)',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  projectName?: string;
}

/** @deprecated alias — keep import sites compiling during rename */
export class BulkUpdateTasksFilterDto extends BulkTasksFilterDto {}

export class BulkUpdateTasksPatchDto {
  @ApiPropertyOptional({ enum: TaskStatus })
  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ description: 'Assign all matched tasks to this member' })
  @IsOptional()
  @IsUUID()
  assigneeId?: string;
}

@ValidatorConstraint({ name: 'atLeastOnePatchField', async: false })
class AtLeastOnePatchFieldConstraint implements ValidatorConstraintInterface {
  validate(patch: BulkUpdateTasksPatchDto | undefined): boolean {
    if (!patch || typeof patch !== 'object') return false;
    return (
      patch.status !== undefined ||
      patch.title !== undefined ||
      patch.description !== undefined ||
      patch.assigneeId !== undefined
    );
  }

  defaultMessage(): string {
    return 'patch must include at least one of: status, title, description, assigneeId';
  }
}

export class BulkUpdateTasksDto {
  @ApiProperty({ type: BulkTasksFilterDto })
  @ValidateNested()
  @Type(() => BulkTasksFilterDto)
  @Validate(AtLeastOneFilterFieldConstraint)
  filter!: BulkTasksFilterDto;

  @ApiProperty({ type: BulkUpdateTasksPatchDto })
  @ValidateNested()
  @Type(() => BulkUpdateTasksPatchDto)
  @Validate(AtLeastOnePatchFieldConstraint)
  patch!: BulkUpdateTasksPatchDto;
}

export class BulkDeleteTasksDto {
  @ApiProperty({ type: BulkTasksFilterDto })
  @ValidateNested()
  @Type(() => BulkTasksFilterDto)
  @Validate(AtLeastOneFilterFieldConstraint)
  filter!: BulkTasksFilterDto;
}
