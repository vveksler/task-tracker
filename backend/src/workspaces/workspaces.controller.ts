import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WorkspaceRole } from '@prisma/client';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { WorkspaceRolesGuard } from '../common/guards/workspace-roles.guard';
import type { JwtPayload } from '../common/types/jwt-payload';
import { WorkspacesService } from './workspaces.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { UpdateWorkspaceDto } from './dto/update-workspace.dto';
import { AddMemberDto } from './dto/add-member.dto';

@ApiTags('workspaces')
@ApiBearerAuth()
@Controller('workspaces')
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new workspace (creator becomes ADMIN)' })
  create(
    @Body() dto: CreateWorkspaceDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.workspacesService.create(dto, user.sub);
  }

  @Get()
  @ApiOperation({ summary: 'List workspaces the current user belongs to' })
  findAll(@CurrentUser() user: JwtPayload) {
    return this.workspacesService.findAllForUser(user.sub);
  }

  @Get(':id')
  @UseGuards(WorkspaceRolesGuard)
  @ApiOperation({ summary: 'Get workspace details (members only)' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.workspacesService.findOne(id);
  }

  @Patch(':id')
  @UseGuards(WorkspaceRolesGuard)
  @Roles(WorkspaceRole.ADMIN)
  @ApiOperation({ summary: 'Update workspace (ADMIN only)' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkspaceDto,
  ) {
    return this.workspacesService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(WorkspaceRolesGuard)
  @Roles(WorkspaceRole.ADMIN)
  @ApiOperation({ summary: 'Delete workspace (ADMIN only)' })
  remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.workspacesService.remove(id);
  }

  @Get(':id/members')
  @UseGuards(WorkspaceRolesGuard)
  @ApiOperation({ summary: 'List workspace members' })
  getMembers(@Param('id', ParseUUIDPipe) id: string) {
    return this.workspacesService.getMembers(id);
  }

  @Post(':id/members')
  @UseGuards(WorkspaceRolesGuard)
  @Roles(WorkspaceRole.ADMIN)
  @ApiOperation({ summary: 'Invite a member to workspace (ADMIN only)' })
  addMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AddMemberDto,
  ) {
    return this.workspacesService.addMember(id, dto);
  }

  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(WorkspaceRolesGuard)
  @Roles(WorkspaceRole.ADMIN)
  @ApiOperation({ summary: 'Remove a member from workspace (ADMIN only)' })
  removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('userId', ParseUUIDPipe) userId: string,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.workspacesService.removeMember(id, userId, user.sub);
  }
}
