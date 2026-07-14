import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator';

@ApiTags('health')
@Controller('health')
@Public()
export class HealthController {
  @Get('live')
  @ApiOperation({ summary: 'Liveness probe — returns 200 if the process is running' })
  live(): { status: string } {
    return { status: 'ok' };
  }
}
