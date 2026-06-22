import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { LogsService } from './logs.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('logs')
export class LogsController {
  private readonly logger = new Logger(LogsController.name);

  constructor(private logs: LogsService) {}

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  async list(@Query('limit') limit?: string) {
    const n = limit ? Math.min(500, parseInt(limit, 10) || 200) : 200;
    return this.logs.findAll(n);
  }

  /** 前端操作监控：点击了什么、后端是否执行成功，会打印到 API 窗口（bat 日志） */
  @Post('client-action')
  @UseGuards(JwtAuthGuard)
  async clientAction(
    @Body() body: { action: string; detail?: string; result?: string },
  ) {
    const { action, detail, result } = body;
    const msg = `[CLIENT] ${action}${detail ? ` | ${detail}` : ''}${result != null ? ` => ${result}` : ''}`;
    this.logger.log(msg);
    return { ok: true };
  }
}
