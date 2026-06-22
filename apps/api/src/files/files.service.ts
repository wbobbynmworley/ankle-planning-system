import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { Role } from '@prisma/client';
import { FileType } from '@prisma/client';
import * as path from 'path';

const ALLOWED_MIMES: Record<string, FileType> = {
  'model/stl': FileType.STL,
  'application/octet-stream': FileType.STL,
  'image/jpeg': FileType.FRONT,
  'image/png': FileType.FRONT,
  'image/jpg': FileType.FRONT,
};

const EXT_TO_TYPE: Record<string, FileType> = {
  '.stl': FileType.STL,
  '.jpg': FileType.FRONT,
  '.jpeg': FileType.FRONT,
  '.png': FileType.FRONT,
};

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

@Injectable()
export class FilesService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  validateFile(mimetype: string, originalName: string, size: number): { type: FileType; err?: string } {
    if (size > MAX_FILE_SIZE) {
      return { type: FileType.OTHER, err: `文件超过 ${MAX_FILE_SIZE / 1024 / 1024}MB 限制` };
    }
    const ext = path.extname(originalName).toLowerCase();
    const typeByExt = EXT_TO_TYPE[ext];
    const typeByMime = ALLOWED_MIMES[mimetype];
    const type = typeByMime ?? typeByExt;
    if (!type) {
      return { type: FileType.OTHER, err: '不允许的文件类型，仅支持 STL、JPG、PNG' };
    }
    return { type };
  }

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

  async upload(
    caseId: string,
    userId: string,
    role: Role,
    file: Express.Multer.File,
    typeOverride?: FileType,
  ) {
    await this.ensureCaseAccess(caseId, userId, role);
    const { type, err } = this.validateFile(file.mimetype, file.originalname, file.size);
    if (err) throw new Error(err);
    const fileType = typeOverride ?? type;

    // 统一正斜杠的相对 key，既作 R2 对象键也作磁盘相对路径
    const safeName = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const key = `cases/${caseId}/${fileType}/${safeName}`;
    await this.storage.put(key, file.buffer, file.mimetype);

    const record = await this.prisma.file.create({
      data: {
        caseId,
        type: fileType,
        path: key,
        originalName: file.originalname,
        mimeType: file.mimetype,
        size: file.size,
      },
    });
    return record;
  }

  async listByCase(caseId: string, userId: string, role: Role) {
    await this.ensureCaseAccess(caseId, userId, role);
    return this.prisma.file.findMany({
      where: { caseId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** 读取文件内容供下载（R2 或磁盘）；返回内容与元数据 */
  async getContent(
    fileId: string,
    userId: string,
    role: Role,
  ): Promise<{ buffer: Buffer; originalName: string; mimeType?: string | null }> {
    const file = await this.prisma.file.findUnique({ where: { id: fileId }, include: { case: true } });
    if (!file) throw new NotFoundException('File not found');
    const c = file.case;
    if (role === Role.ADMIN) {}
    else if (role === Role.DOCTOR && c.doctorId !== userId) throw new ForbiddenException();
    else if (role === Role.PATIENT) {
      const patient = await this.prisma.patient.findFirst({ where: { userId } });
      if (!patient || c.patientId !== patient.id) throw new ForbiddenException();
    }
    try {
      const buffer = await this.storage.get(file.path);
      return { buffer, originalName: file.originalName ?? 'download', mimeType: file.mimeType };
    } catch {
      throw new NotFoundException('文件内容不存在（可能因免费实例重启丢失，请重新上传）');
    }
  }

  async deleteFile(fileId: string, userId: string, role: Role) {
    const file = await this.prisma.file.findUnique({ where: { id: fileId }, include: { case: true } });
    if (!file) throw new NotFoundException('File not found');
    const c = file.case;
    if (role !== Role.ADMIN && c.doctorId !== userId) throw new ForbiddenException();
    await this.storage.delete(file.path).catch(() => undefined);
    await this.prisma.file.delete({ where: { id: fileId } });
    return { ok: true };
  }
}
