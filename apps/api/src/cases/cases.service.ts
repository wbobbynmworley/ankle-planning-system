import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';
import { CaseStatus, FileType } from '@prisma/client';
import { FilesService } from '../files/files.service';

@Injectable()
export class CasesService {
  constructor(
    private prisma: PrismaService,
    private files: FilesService,
  ) {}

  /** 医生/管理员创建病例：按患者姓名+身份证号查找或创建 Patient，再创建 Case */
  async create(doctorId: string, dto: { patientName: string; patientIdNumber: string; description?: string }) {
    const { patientName, patientIdNumber, description } = dto;
    const idNumber = String(patientIdNumber).trim();
    if (!idNumber) throw new BadRequestException('请输入患者身份证号');
    const patient = await this.prisma.patient.upsert({
      where: { idNumber },
      create: { idNumber, name: (patientName || '').trim() || null },
      update: { name: (patientName || '').trim() || undefined },
    });
    return this.prisma.case.create({
      data: {
        doctorId,
        patientId: patient.id,
        description: description?.trim() || null,
        status: CaseStatus.DRAFT,
      },
      include: {
        patient: { select: { id: true, idNumber: true, name: true } },
        doctor: { select: { id: true, name: true } },
      },
    });
  }

  /** 创建病例并上传影像：至少需传 STL 或 正位/侧位 之一 */
  async createWithFiles(
    doctorId: string,
    role: Role,
    dto: { patientName: string; patientIdNumber: string; description?: string },
    files: { stl?: Express.Multer.File[]; front?: Express.Multer.File[]; side?: Express.Multer.File[] },
  ) {
    const stl = files.stl?.[0];
    const front = files.front?.[0];
    const side = files.side?.[0];
    if (!stl && !front && !side) {
      throw new BadRequestException('请至少上传一种影像数据：STL 模型或正位图/侧位图');
    }
    const caseRecord = await this.create(doctorId, dto);
    const caseId = caseRecord.id;
    try {
      if (stl) await this.files.upload(caseId, doctorId, role, stl, FileType.STL);
      if (front) await this.files.upload(caseId, doctorId, role, front, FileType.FRONT);
      if (side) await this.files.upload(caseId, doctorId, role, side, FileType.SIDE);
    } catch (err) {
      await this.prisma.case.delete({ where: { id: caseId } }).catch(() => {});
      throw err;
    }
    return this.prisma.case.findUnique({
      where: { id: caseId },
      include: {
        patient: { select: { id: true, idNumber: true, name: true } },
        doctor: { select: { id: true, name: true } },
        files: true,
      },
    });
  }

  /** 待规划列表：已导入影像、未完成术后规划（status 非 POSTOP_DONE/COMPLETED） */
  async findForPlanning(userId: string, role: Role) {
    const baseWhere: any = {
      status: { in: [CaseStatus.DRAFT, CaseStatus.PENDING_PLAN, CaseStatus.PLANNED, CaseStatus.PREOP_DONE] },
      files: { some: {} },
    };
    if (role === Role.DOCTOR) baseWhere.doctorId = userId;
    if (role === Role.PATIENT) {
      const patient = await this.prisma.patient.findFirst({ where: { userId } });
      if (!patient) return [];
      baseWhere.patientId = patient.id;
    }
    return this.prisma.case.findMany({
      where: baseWhere,
      orderBy: { updatedAt: 'desc' },
      include: {
        patient: { select: { id: true, idNumber: true, name: true } },
        doctor: { select: { id: true, name: true } },
        files: { select: { id: true, type: true } },
        plans: { take: 1, orderBy: { createdAt: 'desc' }, select: { id: true, algoType: true } },
      },
    });
  }

  async findForUser(userId: string, role: Role, opts?: { search?: string; status?: string; page?: number; limit?: number }) {
    const where: any = {};
    if (role === Role.ADMIN) {
      /* no extra where */
    } else if (role === Role.DOCTOR) {
      where.doctorId = userId;
    } else if (role === Role.PATIENT) {
      const patient = await this.prisma.patient.findFirst({ where: { userId } });
      if (!patient) return [];
      where.patientId = patient.id;
    } else {
      return [];
    }
    if (opts?.search && opts.search.trim()) {
      const q = opts.search.trim();
      where.OR = [
        { id: { contains: q } },
        { description: { contains: q } },
        { patient: { name: { contains: q } } },
        { patient: { idNumber: { contains: q } } },
      ];
    }
    if (opts?.status && opts.status.trim()) {
      const s = opts.status.trim() as CaseStatus;
      if (Object.values(CaseStatus).includes(s)) where.status = s;
    }
    const page = Math.max(1, opts?.page ?? 1);
    const limit = Math.min(100, Math.max(1, opts?.limit ?? 50));
    const skip = (page - 1) * limit;
    const include = role === Role.ADMIN
      ? { patient: { select: { id: true, idNumber: true, name: true } }, doctor: { select: { id: true, name: true, email: true } } }
      : role === Role.DOCTOR
        ? { patient: { select: { id: true, idNumber: true, name: true } } }
        : { doctor: { select: { id: true, name: true } } };
    return this.prisma.case.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include,
      skip,
      take: limit,
    });
  }

  async findOne(id: string, userId: string, role: Role) {
    const c = await this.prisma.case.findUnique({
      where: { id },
      include: {
        patient: { select: { id: true, idNumber: true, name: true } },
        doctor: { select: { id: true, name: true, email: true } },
        files: true,
        plans: true,
      },
    });
    if (!c) throw new NotFoundException('Case not found');
    if (role === Role.ADMIN) return c;
    if (role === Role.DOCTOR && c.doctorId !== userId) throw new ForbiddenException();
    if (role === Role.PATIENT) {
      const patient = await this.prisma.patient.findFirst({ where: { userId } });
      if (!patient || c.patientId !== patient.id) throw new ForbiddenException();
    }
    return c;
  }

  async update(
    id: string,
    userId: string,
    role: Role,
    body: { status?: string; description?: string },
  ) {
    const c = await this.prisma.case.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Case not found');
    if (role !== Role.ADMIN && c.doctorId !== userId) throw new ForbiddenException();
    const data: { status?: CaseStatus; description?: string } = {};
    if (body.status != null) {
      const s = body.status as CaseStatus;
      if (Object.values(CaseStatus).includes(s)) data.status = s;
    }
    if (body.description !== undefined) data.description = body.description ?? null;
    return this.prisma.case.update({ where: { id }, data });
  }

  async remove(id: string, userId: string, role: Role) {
    const c = await this.prisma.case.findUnique({ where: { id } });
    if (!c) throw new NotFoundException('Case not found');
    if (role !== Role.ADMIN && c.doctorId !== userId) throw new ForbiddenException();
    return this.prisma.case.delete({ where: { id } });
  }
}
