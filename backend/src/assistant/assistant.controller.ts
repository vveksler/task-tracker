// This controller is the ONLY thing the frontend talks to for the AI
// assistant. It reuses the exact same WorkspaceRolesGuard as every other
// workspace-scoped endpoint in this codebase.
// Membership alone is enough (no @Roles) — same pattern as analytics.

import {
  Body,
  Controller,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { WorkspaceRolesGuard } from '../common/guards/workspace-roles.guard';
import { AiAssistantEnabledGuard } from './ai-assistant-enabled.guard';
import { AssistantService } from './assistant.service';
import { AskAssistantDto } from './dto/ask-assistant.dto';

@ApiTags('assistant')
@ApiBearerAuth()
@Controller('workspaces/:workspaceId/assistant')
@UseGuards(WorkspaceRolesGuard, AiAssistantEnabledGuard)
export class AssistantController {
  constructor(private readonly assistantService: AssistantService) {}

  @Post('ask')
  @ApiOperation({
    summary: 'Ask a question about tasks in this workspace (SSE stream)',
  })
  async ask(
    @Param('workspaceId', ParseUUIDPipe) workspaceId: string,
    @Body() dto: AskAssistantDto,
    @Res() res: Response,
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    // Disable nginx/proxy buffering for SSE if present.
    res.setHeader('X-Accel-Buffering', 'no');

    const stream = await this.assistantService.ask(
      workspaceId,
      dto.question,
      dto.currentProjectId,
      dto.history,
    );

    try {
      for await (const chunk of stream) {
        res.write(chunk);
      }
    } finally {
      res.end();
    }
  }
}
