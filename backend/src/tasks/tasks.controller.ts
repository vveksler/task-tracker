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
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WorkspaceRolesGuard } from '../common/guards/workspace-roles.guard';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { ReorderTaskDto } from './dto/reorder-task.dto';

@ApiTags('tasks')
@ApiBearerAuth()
@UseGuards(WorkspaceRolesGuard)
@Controller('workspaces/:workspaceId/tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  @ApiOperation({ summary: 'Create a task in a project' })
  create(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body() dto: CreateTaskDto,
  ) {
    return this.tasksService.create(workspaceId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List tasks in a project' })
  findAll(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Query('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return this.tasksService.findAllByProject(workspaceId, projectId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get task details' })
  findOne(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tasksService.findOne(workspaceId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update task fields (title, description, status, assignee)' })
  update(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.tasksService.update(workspaceId, id, dto);
  }

  @Patch(':id/reorder')
  @ApiOperation({
    summary: 'Reorder task — move to new position/column (transactional)',
  })
  reorder(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReorderTaskDto,
  ) {
    return this.tasksService.reorder(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a task' })
  remove(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.tasksService.remove(workspaceId, id);
  }
}
