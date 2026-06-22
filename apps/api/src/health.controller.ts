import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma/prisma.service';
import { StorageService } from './storage/storage.service';

/** 公开健康检查（无需鉴权），供部署平台（Render/Uptime 等）探活与前端检测 API/配置是否在线。 */
@Controller('health')
export class HealthController {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  @Get()
  async health() {
    let db = false;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = true;
    } catch {
      db = false;
    }
    return {
      status: db ? 'ok' : 'degraded',
      db,
      // 诊断用：存储后端（r2=持久 / disk=临时，重启会丢上传文件）、算法服务是否已配置
      storage: this.storage.usingR2 ? 'r2' : 'disk',
      algoConfigured: !!process.env.ALGO_SERVICE_URL,
      time: new Date().toISOString(),
    };
  }
}
