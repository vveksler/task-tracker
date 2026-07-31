import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class AssistantHistoryTurnDto {
  @ApiProperty({ enum: ['user', 'assistant'] })
  @IsIn(['user', 'assistant'])
  role!: 'user' | 'assistant';

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  content!: string;
}

export class AskAssistantDto {
  @ApiProperty({
    example: 'What tasks are blocked on auth?',
    description: 'Natural-language question about tasks in this workspace',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  question!: string;

  @ApiPropertyOptional({
    description:
      'Project the user is currently viewing (board). Scopes "this project" mutations.',
  })
  @IsOptional()
  @IsUUID()
  currentProjectId?: string;

  @ApiPropertyOptional({
    type: [AssistantHistoryTurnDto],
    description:
      'Prior turns in this chat (excluding the current question). Enables "yes" / follow-ups.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AssistantHistoryTurnDto)
  history?: AssistantHistoryTurnDto[];
}
