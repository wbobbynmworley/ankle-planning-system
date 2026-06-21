import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';
import { MeasurementStage } from '@prisma/client';

@Injectable()
export class MeasurementsService {
  constructor(private prisma: PrismaService) {}

  async ensureCaseAccess(caseId: string, userId: string, role: Role) {
    const c = await this.prisma.case.findUnique({ where: { id: caseId } });
    if (!c) throw new NotFoundException('Case not found');
    if (role === Role.ADMIN) return;
    if (role === Role.DOCTOR && c.doctorId !== userId) throw new ForbiddenException();
    if (role === Role.PATIENT) {
      const patient = await this.prisma.patient.findFirst({ where: { userId } });
      if (!patient || c.patientId !== patient.id) throw new ForbiddenException();
    }
  }

  async create(
    userId: string,
    role: Role,
    data: { caseId: string; stage: MeasurementStage; viewKey?: string; values: Record<string, number | string> },
  ) {
    await this.ensureCaseAccess(data.caseId, userId, role);
    return this.prisma.measurement.create({
      data: {
        caseId: data.caseId,
        stage: data.stage,
        viewKey: data.viewKey ?? null,
        values: data.values as any,
      },
    });
  }

  async findByCaseAndStage(
    caseId: string,
    stage: MeasurementStage,
    userId: string,
    role: Role,
  ) {
    await this.ensureCaseAccess(caseId, userId, role);
    return this.prisma.measurement.findMany({
      where: { caseId, stage },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string, userId: string, role: Role) {
    const m = await this.prisma.measurement.findUnique({
      where: { id },
      include: { case: true },
    });
    if (!m) throw new NotFoundException('Measurement not found');
    await this.ensureCaseAccess(m.caseId, userId, role);
    return m;
  }
}
