import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';

/** 公开健康检查（无需鉴权），供部署平台（Render/Uptime 等）探活与前端检测 API 是否在线。 */
@Controller('health')
export class HealthController {
  constructor(private prisma: PrismaService) {}

  @Get()
  async health() {
    let db = false;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = true;
    } catch {
      db = false;
    }
    return { status: db ? 'ok' : 'degraded', db, time: new Date().toISOString() };
  }
}
