import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WorkspaceRolesGuard } from '../common/guards/workspace-roles.guard';
import { AnalyticsService } from './analytics.service';
import { ActivityQueryDto } from './dto/activity-query.dto';

@ApiTags('analytics')
@ApiBearerAuth()
@UseGuards(WorkspaceRolesGuard)
@Controller('workspaces/:workspaceId/analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('status-breakdown')
  @ApiOperation({ summary: 'Task count per status across all projects' })
  statusBreakdown(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
  ) {
    return this.analyticsService.statusBreakdown(workspaceId);
  }

  @Get('activity')
  @ApiOperation({ summary: 'Daily created/updated task counts (raw SQL, time-bucketed)' })
  activity(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Query() query: ActivityQueryDto,
  ) {
    return this.analyticsService.activity(workspaceId, query.days ?? 30);
  }

  @Get('assignee-load')
  @ApiOperation({ summary: 'Task count per assignee, broken down by status' })
  assigneeLoad(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
  ) {
    return this.analyticsService.assigneeLoad(workspaceId);
  }
}
