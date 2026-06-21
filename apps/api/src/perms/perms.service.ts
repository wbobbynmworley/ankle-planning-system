import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';

@Injectable()
export class PermsService {
  constructor(private prisma: PrismaService) {}

  async listRoles(): Promise<{ role: string; label: string }[]> {
    return [
      { role: 'ADMIN', label: '管理员' },
      { role: 'DOCTOR', label: '医生' },
      { role: 'PATIENT', label: '患者' },
    ];
  }

  async getFunctionPermissions(role?: string) {
    const where = role ? { role } : {};
    return this.prisma.rolePermission.findMany({
      where,
      orderBy: [{ role: 'asc' }, { resource: 'asc' }, { action: 'asc' }],
    });
  }

  async setFunctionPermissions(
    role: string,
    permissions: Array<{ resource: string; action: string; allowed: boolean }>,
  ) {
    await this.prisma.rolePermission.deleteMany({ where: { role } });
    if (permissions.length === 0) return this.getFunctionPermissions(role);
    await this.prisma.rolePermission.createMany({
      data: permissions.map((p) => ({ role, resource: p.resource, action: p.action, allowed: p.allowed })),
    });
    return this.getFunctionPermissions(role);
  }

  async getDataPermissions(role?: string) {
    const where = role ? { role } : {};
    return this.prisma.dataPermission.findMany({
      where,
      orderBy: { role: 'asc' },
    });
  }

  async setDataPermissions(role: string, scope: string, resource?: string) {
    await this.prisma.dataPermission.deleteMany({ where: { role } });
    await this.prisma.dataPermission.create({
      data: { role, scope, resource: resource ?? null },
    });
    return this.getDataPermissions(role);
  }
}
