import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional } from 'class-validator';
import { WorkspaceRole } from '@prisma/client';

export class AddMemberDto {
  @ApiProperty({ example: 'newuser@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ enum: WorkspaceRole, default: WorkspaceRole.MEMBER })
  @IsEnum(WorkspaceRole)
  @IsOptional()
  role?: WorkspaceRole;
}
