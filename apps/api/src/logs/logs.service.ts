import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LogsService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string | null, action: string, ip?: string, meta?: object) {
    return this.prisma.log.create({
      data: { userId, action, ip: ip ?? null, meta: meta ?? undefined },
    });
  }

  async findAll(limit = 200) {
    return this.prisma.log.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        user: { select: { id: true, email: true, role: true } },
      },
    });
  }
}
