import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';

const SALT_ROUNDS = 12;

@Injectable()
export class AdminSeedService implements OnModuleInit {
  private readonly logger = new Logger(AdminSeedService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    // 如果已经有 ADMIN，就不再创建
    const adminExists = await this.prisma.user.count({ where: { role: Role.ADMIN } });
    if (adminExists > 0) return;

    const email = process.env.ADMIN_EMAIL || 'admin@ankle.local';
    const password = process.env.ADMIN_PASSWORD || '123456';
    const name = process.env.ADMIN_NAME || '系统管理员';

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    await this.prisma.user.create({
      data: {
        email,
        passwordHash,
        name,
        role: Role.ADMIN,
        phone: null,
      },
    });

    this.logger.log(`Seeded default admin: ${email} / ${password}`);
  }
}

