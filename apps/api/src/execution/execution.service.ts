import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';
import { CaseStatus } from '@prisma/client';

export interface RodStepData {
  rodLength: number;
  scale: number;
}

export interface DailyStepRow {
  stepIndex: number;
  planTime: string;
  rod1: RodStepData;
  rod2: RodStepData;
  rod3: RodStepData;
  rod4: RodStepData;
  rod5: RodStepData;
  rod6: RodStepData;
  note?: string;
  completed: boolean;
}

export interface ExecutionPlanResponse {
  caseId: string;
  patient: { name?: string | null; idNumber?: string };
  doctor: { name?: string | null };
  initialInstallation: {
    referenceRing: { model?: string };
    movingRing: { model?: string };
    rotationDirection?: string;
    rotationAngle?: number;
    rods: Array<{ model?: string; length: number; scale: number }>;
  };
  dailySteps: DailyStepRow[];
}

@Injectable()
export class ExecutionService {
  constructor(private prisma: PrismaService) {}

  private async ensureCaseAccess(caseId: string, userId: string, role: Role) {
    const c = await this.prisma.case.findUnique({ where: { id: caseId } });
    if (!c) throw new NotFoundException('Case not found');
    if (role === Role.ADMIN) return;
    if (role === Role.DOCTOR && c.doctorId !== userId) throw new ForbiddenException();
    if (role === Role.PATIENT) {
      const patient = await this.prisma.patient.findFirst({ where: { userId } });
      if (!patient || c.patientId !== patient.id) throw new ForbiddenException();
    }
  }

  /** 已完成术后规划的患者列表（有 Plan 且 status 为 PLANNED/POSTOP_DONE 等） */
  async listPatients(userId: string, role: Role) {
    const baseWhere: any = {
      plans: { some: {} },
      status: { in: [CaseStatus.PLANNED, CaseStatus.PREOP_DONE, CaseStatus.POSTOP_DONE] },
    };
    if (role === Role.DOCTOR) baseWhere.doctorId = userId;
    if (role === Role.PATIENT) {
      const patient = await this.prisma.patient.findFirst({ where: { userId } });
      if (!patient) return [];
      baseWhere.patientId = patient.id;
    }
    return this.prisma.case.findMany({
      where: baseWhere,
      include: {
        patient: { select: { id: true, name: true, idNumber: true } },
        doctor: { select: { name: true } },
        plans: { take: 1, orderBy: { createdAt: 'desc' } },
      },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getPlanByCaseId(caseId: string, userId: string, role: Role): Promise<ExecutionPlanResponse> {
    await this.ensureCaseAccess(caseId, userId, role);
    const c = await this.prisma.case.findUnique({
      where: { id: caseId },
      include: {
        patient: { select: { name: true, idNumber: true } },
        doctor: { select: { name: true } },
        plans: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (!c) throw new NotFoundException('Case not found');
    const plan = c.plans[0];
    if (!plan) throw new NotFoundException('No plan found for this case');

    const instrumentConfig = (plan.instrumentConfig as any) || {};
    const initialScales = (plan.initialScales as any) || [];
    const refRing = instrumentConfig.referenceRingName || instrumentConfig.referenceRingCode || '—';
    const movRing = instrumentConfig.movingRingName || instrumentConfig.movingRingCode || '—';
    const rodModels = instrumentConfig.rodNames || instrumentConfig.rodCodes || Array(6).fill('—');
    const rodsInitial = Array.from({ length: 6 }, (_, i) => {
      const init = initialScales[i];
      return {
        model: Array.isArray(rodModels) ? rodModels[i] : '—',
        length: init?.lengthMm ?? 155,
        scale: init?.scale ?? 0,
      };
    });

    let dailySteps: DailyStepRow[] = [];
    const rawSteps = (plan.dailySteps as any[] | null) ?? [];
    if (rawSteps.length > 0 && typeof rawSteps[0] === 'object' && (rawSteps[0] as any).rod1 != null) {
      dailySteps = rawSteps.map((s: any, i: number) => ({
        stepIndex: i + 1,
        planTime: s.planTime ?? new Date(Date.now() + (i + 1) * 86400000).toISOString().slice(0, 10),
        rod1: { rodLength: s.rod1?.rodLength ?? rodsInitial[0].length, scale: s.rod1?.scale ?? rodsInitial[0].scale },
        rod2: { rodLength: s.rod2?.rodLength ?? rodsInitial[1].length, scale: s.rod2?.scale ?? rodsInitial[1].scale },
        rod3: { rodLength: s.rod3?.rodLength ?? rodsInitial[2].length, scale: s.rod3?.scale ?? rodsInitial[2].scale },
        rod4: { rodLength: s.rod4?.rodLength ?? rodsInitial[3].length, scale: s.rod4?.scale ?? rodsInitial[3].scale },
        rod5: { rodLength: s.rod5?.rodLength ?? rodsInitial[4].length, scale: s.rod5?.scale ?? rodsInitial[4].scale },
        rod6: { rodLength: s.rod6?.rodLength ?? rodsInitial[5].length, scale: s.rod6?.scale ?? rodsInitial[5].scale },
        note: s.note,
        completed: !!s.completed,
      }));
    } else {
      const totalDays = plan.totalDays ?? 1;
      for (let i = 0; i < totalDays; i++) {
        dailySteps.push({
          stepIndex: i + 1,
          planTime: new Date(Date.now() + (i + 1) * 86400000).toISOString().slice(0, 10),
          rod1: { rodLength: rodsInitial[0].length, scale: rodsInitial[0].scale },
          rod2: { rodLength: rodsInitial[1].length, scale: rodsInitial[1].scale },
          rod3: { rodLength: rodsInitial[2].length, scale: rodsInitial[2].scale },
          rod4: { rodLength: rodsInitial[3].length, scale: rodsInitial[3].scale },
          rod5: { rodLength: rodsInitial[4].length, scale: rodsInitial[4].scale },
          rod6: { rodLength: rodsInitial[5].length, scale: rodsInitial[5].scale },
          completed: false,
        });
      }
    }

    return {
      caseId: c.id,
      patient: c.patient,
      doctor: c.doctor,
      initialInstallation: {
        referenceRing: { model: refRing },
        movingRing: { model: movRing },
        rotationDirection: instrumentConfig.rotationDirection,
        rotationAngle: instrumentConfig.rotationAngle,
        rods: rodsInitial,
      },
      dailySteps,
    };
  }

  async updateStep(
    caseId: string,
    stepIndex: number,
    userId: string,
    role: Role,
    body: {
      planTime?: string;
      rod1Scale?: number;
      rod2Scale?: number;
      rod3Scale?: number;
      rod4Scale?: number;
      rod5Scale?: number;
      rod6Scale?: number;
      rod1Length?: number;
      rod2Length?: number;
      rod3Length?: number;
      rod4Length?: number;
      rod5Length?: number;
      rod6Length?: number;
      completed?: boolean;
    },
  ) {
    await this.ensureCaseAccess(caseId, userId, role);
    const plan = await this.prisma.plan.findFirst({
      where: { caseId },
      orderBy: { createdAt: 'desc' },
    });
    if (!plan) throw new NotFoundException('Plan not found');
    const steps = ((plan.dailySteps as any[]) ?? []).slice();
    const idx = stepIndex - 1;
    if (idx < 0 || idx >= steps.length) {
      while (steps.length <= idx) {
        steps.push({
          planTime: new Date(Date.now() + (steps.length + 1) * 86400000).toISOString().slice(0, 10),
          rod1: { rodLength: 155, scale: 0 },
          rod2: { rodLength: 155, scale: 0 },
          rod3: { rodLength: 155, scale: 0 },
          rod4: { rodLength: 155, scale: 0 },
          rod5: { rodLength: 155, scale: 0 },
          rod6: { rodLength: 155, scale: 0 },
          completed: false,
        });
      }
    }
    const row = steps[idx] || {};
    if (body.planTime != null) row.planTime = body.planTime;
    if (body.completed != null) row.completed = body.completed;
    const rodKeys = ['rod1', 'rod2', 'rod3', 'rod4', 'rod5', 'rod6'];
    for (let i = 0; i < 6; i++) {
      const scaleKey = `rod${i + 1}Scale` as keyof typeof body;
      const lengthKey = `rod${i + 1}Length` as keyof typeof body;
      if (body[scaleKey] != null) {
        if (!row[rodKeys[i]]) row[rodKeys[i]] = { rodLength: 155, scale: 0 };
        row[rodKeys[i]].scale = body[scaleKey];
      }
      if (body[lengthKey] != null) {
        if (!row[rodKeys[i]]) row[rodKeys[i]] = { rodLength: 155, scale: 0 };
        row[rodKeys[i]].rodLength = body[lengthKey];
      }
    }
    steps[idx] = row;
    await this.prisma.plan.update({
      where: { id: plan.id },
      data: { dailySteps: steps as any },
    });
    return this.getPlanByCaseId(caseId, userId, role);
  }

  /** 患者记录矫正执行（实际步数、备注、标记完成） */
  async recordPatientExecution(
    caseId: string,
    stepIndex: number,
    userId: string,
    completed = true,
    actualSteps?: number,
    note?: string,
  ) {
    // 患者只能操作自己的病例
    const patient = await this.prisma.patient.findFirst({ where: { userId } });
    if (!patient) throw new NotFoundException('Patient not found');

    const c = await this.prisma.case.findUnique({ where: { id: caseId } });
    if (!c) throw new NotFoundException('Case not found');
    if (c.patientId !== patient.id) throw new ForbiddenException();

    const plan = await this.prisma.plan.findFirst({
      where: { caseId },
      orderBy: { createdAt: 'desc' },
    });
    if (!plan) throw new NotFoundException('Plan not found');

    const steps = ((plan.dailySteps as any[]) ?? []).slice();
    const idx = stepIndex - 1;
    if (idx < 0 || idx >= steps.length) {
      throw new NotFoundException(`Step ${stepIndex} out of range (total: ${steps.length})`);
    }

    // 追加患者执行数据
    const row = { ...steps[idx] };
    row.completed = completed;
    row.actualSteps = actualSteps ?? row.actualSteps ?? null;
    row.note = note ?? row.note ?? null;
    row.recordedAt = new Date().toISOString();
    steps[idx] = row;

    await this.prisma.plan.update({
      where: { id: plan.id },
      data: { dailySteps: steps as any },
    });

    return { success: true, stepIndex, recordedAt: row.recordedAt };
  }

  /** 患者治疗进度总览（按病例分组含每日执行情况） */
  async getPatientProgressOverview(userId: string) {
    const patient = await this.prisma.patient.findFirst({ where: { userId } });
    if (!patient) return [];

    const cases = await this.prisma.case.findMany({
      where: {
        patientId: patient.id,
        plans: { some: {} },
      },
      include: {
        patient: { select: { id: true, name: true, idNumber: true } },
        doctor: { select: { id: true, name: true } },
        plans: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { updatedAt: 'desc' },
    });

    return cases.map((c) => {
      const plan = c.plans[0];
      const steps = ((plan?.dailySteps as any[]) ?? []) as Array<{
        stepIndex?: number;
        planTime?: string;
        completed?: boolean;
        actualSteps?: number;
        recordedAt?: string;
        note?: string;
      }>;
      const totalDays = plan?.totalDays ?? steps.length;
      const completedDays = steps.filter((s) => s.completed).length;
      const totalSteps = steps.reduce((sum, s) => sum + (s.actualSteps ?? 0), 0);

      // 计算进度百分比（按计划天数）
      const progressPercent = totalDays > 0 ? Math.round((completedDays / totalDays) * 100) : 0;

      // 计算计划vs实际步数对比（取前7天用于图表）
      const chartData = steps.slice(0, 7).map((s, i) => ({
        day: i + 1,
        planned: s.actualSteps ?? 100, // 假设每日目标100步（可从plan.dailySteps计划值获取）
        actual: s.actualSteps ?? 0,
        date: s.planTime ?? '',
        completed: s.completed ?? false,
      }));

      return {
        caseId: c.id,
        caseStatus: c.status,
        doctorName: c.doctor.name ?? '—',
        planId: plan?.id,
        totalDays,
        completedDays,
        progressPercent,
        totalSteps,
        chartData,
        steps: steps.slice(0, 14), // 最近14天详情
      };
    });
  }
}
