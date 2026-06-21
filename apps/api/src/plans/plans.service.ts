import {
  BadRequestException,
  BadGatewayException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PlanAlgoType, Prisma, Role } from '@prisma/client';
import { AlgoService } from '../algo/algo.service';
import { CaseStatus } from '@prisma/client';
import * as path from 'path';
import * as fs from 'fs';
import { createRequire } from 'module';
import { TaylorService, MeasurementSummary, InstrumentConfigInput, RodScaleResult } from '../taylor/taylor.service';
import { InstrumentsService } from '../instruments/instruments.service';

@Injectable()
export class PlansService {
  private readonly logger = new Logger(PlansService.name);

  constructor(
    private prisma: PrismaService,
    private algo: AlgoService,
    private taylor: TaylorService,
    private instruments: InstrumentsService,
  ) {}

  async checkAlgoHealth(): Promise<{ ok: boolean; message?: string }> {
    return this.algo.checkHealth();
  }

  /** SAM 分割预测（转发到 algo 服务） */
  async segmentationPredict(payload: {
    image_base64: string;
    box: [number, number, number, number];
  }): Promise<{ candidates: Array<{ score: number; mask_base64: string }> }> {
    return this.algo.segmentationPredict(payload);
  }

  /** 掩码保存（与 2dmax.py 完全一致：postprocess 后保存到 YYYYMMDD/view_key_role_engine_HHMMSS_ffffff.png） */
  async saveMask(
    caseId: string,
    userId: string,
    userRole: Role,
    payload: { view_key: string; role: string; engine_name: string; mask_base64: string },
  ): Promise<{ path: string; mask_save_root: string }> {
    const c = await this.prisma.case.findUnique({ where: { id: caseId } });
    if (!c) throw new NotFoundException('Case not found');
    if (userRole !== 'ADMIN' && c.doctorId !== userId) throw new ForbiddenException();

    const { mask_base64 } = await this.algo.postprocessMask(payload.mask_base64);
    const maskSaveRoot = process.env.MASK_SAVE_ROOT ?? path.join(process.env.FILE_STORAGE_PATH ?? path.join(process.cwd(), 'storage'), 'mask_save');
    const d = new Date();
    const pad = (n: number, len: number) => String(n).padStart(len, '0');
    const dayDir = path.join(maskSaveRoot, `${d.getFullYear()}${pad(d.getMonth() + 1, 2)}${pad(d.getDate(), 2)}`);
    const ts = `${pad(d.getHours(), 2)}${pad(d.getMinutes(), 2)}${pad(d.getSeconds(), 2)}_${pad(d.getMilliseconds() * 1000, 6)}`;
    const fileName = `${payload.view_key}_${payload.role}_${payload.engine_name}_${ts}.png`;
    const outPath = path.join(dayDir, fileName);
    fs.mkdirSync(dayDir, { recursive: true });
    const buf = Buffer.from(mask_base64, 'base64');
    fs.writeFileSync(outPath, buf);
    return { path: outPath, mask_save_root: maskSaveRoot };
  }

  /** 已保存掩码按路径读取为 base64，供前端恢复掩码使用 */
  async loadSavedMask(maskPath: string, userId: string, userRole: Role): Promise<{ mask_base64: string }> {
    if (!maskPath) throw new NotFoundException('Mask path is empty');
    // 仅医生/管理员可读取保存目录下的掩码
    if (userRole !== Role.ADMIN && userRole !== Role.DOCTOR) {
      throw new ForbiddenException();
    }
    const maskSaveRoot = (process.env.MASK_SAVE_ROOT ?? path.join(process.env.FILE_STORAGE_PATH ?? path.join(process.cwd(), 'storage'), 'mask_save'));
    const rootNorm = path.resolve(maskSaveRoot);
    const full = path.resolve(maskPath);
    if (!full.startsWith(rootNorm)) {
      // 只允许读取 mask_save 目录下的文件，避免任意路径读盘
      throw new ForbiddenException('Mask path outside mask_save root');
    }
    if (!fs.existsSync(full)) {
      throw new NotFoundException('Mask file not found');
    }
    const buf = fs.readFileSync(full);
    return { mask_base64: buf.toString('base64') };
  }

  async findForCase(caseId: string, userId: string, role: Role) {
    const c = await this.prisma.case.findUnique({
      where: { id: caseId },
      select: { doctorId: true, patientId: true },
    });
    if (!c) throw new NotFoundException('Case not found');
    if (role === Role.ADMIN) {}
    else if (role === Role.DOCTOR && c.doctorId !== userId) throw new ForbiddenException();
    else if (role === Role.PATIENT) {
      const patient = await this.prisma.patient.findFirst({ where: { userId } });
      if (!patient || c.patientId !== patient.id) throw new ForbiddenException();
    }

    return this.prisma.plan.findMany({
      where: { caseId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(planId: string, userId: string, role: Role) {
    const plan = await this.prisma.plan.findUnique({
      where: { id: planId },
      include: { case: { include: { patient: true, doctor: true } } },
    });
    if (!plan) throw new NotFoundException('Plan not found');
    const c = plan.case;
    if (role === Role.ADMIN) {}
    else if (role === Role.DOCTOR && c.doctorId !== userId) throw new ForbiddenException();
    else if (role === Role.PATIENT) {
      const patient = await this.prisma.patient.findFirst({ where: { userId } });
      if (!patient || c.patientId !== patient.id) throw new ForbiddenException();
    }
    return plan;
  }

  async triggerPlan(
    caseId: string,
    userId: string,
    role: Role,
    algoType: '2d' | '3d',
    body?: {
      startMm?: number[];
      goalMm?: number[];
      frontMmPerPx?: number;
      sideMmPerPx?: number;
      frontRefMaskPath?: string;
      frontMovMaskPath?: string;
      sideRefMaskPath?: string;
      sideMovMaskPath?: string;
    },
  ) {
    const c = await this.prisma.case.findUnique({
      where: { id: caseId },
      include: { files: true },
    });
    if (!c) throw new NotFoundException('Case not found');
    if (role !== Role.ADMIN && c.doctorId !== userId) throw new ForbiddenException();

    const storageRoot = process.env.FILE_STORAGE_PATH ?? path.join(process.cwd(), 'storage');
    const files = (c.files ?? []) as Array<{ type: string; path: string }>;
    const frontFile = files.find((f) => f.type === 'FRONT');
    const sideFile = files.find((f) => f.type === 'SIDE');

    let result: { totalDistance: number; totalDays: number; dailySteps: unknown[]; rawPath: unknown[] };
    if (algoType === '2d') {
      const frontImagePath = frontFile ? path.resolve(storageRoot, frontFile.path) : undefined;
      const sideImagePath = sideFile ? path.resolve(storageRoot, sideFile.path) : undefined;
      const payload = {
        front_image_path: frontImagePath ?? null,
        side_image_path: sideImagePath ?? null,
        front_ref_mask_path: body?.frontRefMaskPath || null,
        front_mov_mask_path: body?.frontMovMaskPath || null,
        side_ref_mask_path: body?.sideRefMaskPath || null,
        side_mov_mask_path: body?.sideMovMaskPath || null,
        front_mm_per_px: body?.frontMmPerPx ?? 0.1,
        side_mm_per_px: body?.sideMmPerPx ?? 0.1,
        start_mm: Array.isArray(body?.startMm) && body.startMm.length >= 3 ? body.startMm.slice(0, 3) : [0, 0, 0],
        goal_mm: Array.isArray(body?.goalMm) && body.goalMm.length >= 3 ? body.goalMm.slice(0, 3) : [0, 0, 0],
        day_step_mm: 1.0,
      };
      // 重新规划 2D 时，清理旧的 PLAN_2D 记录，避免脏数据
      await this.prisma.plan.deleteMany({ where: { caseId, algoType: PlanAlgoType.PLAN_2D } });
      result = await this.algo.plan2d(payload);
    } else {
      const stlFiles = files.filter((f) => f.type === 'STL');
      const stlPaths = stlFiles.map((f) => path.resolve(storageRoot, f.path));
      const startMm = Array.isArray(body?.startMm) && body.startMm.length >= 3 ? body.startMm.slice(0, 3) : [0, 0, 0];
      const goalMm = Array.isArray(body?.goalMm) && body.goalMm.length >= 3 ? body.goalMm.slice(0, 3) : [5, 0, 0];
      const payload = {
        stl_paths: stlPaths,
        start_t: startMm,
        goal_t: goalMm,
        day_step_mm: 1.0,
      };
      // 重新规划 3D 时，清理旧的 PLAN_3D 记录
      await this.prisma.plan.deleteMany({ where: { caseId, algoType: PlanAlgoType.PLAN_3D } });
      result = await this.algo.plan3d(payload);
    }

    const plan = await this.prisma.plan.create({
      data: {
        caseId,
        algoType: algoType === '2d' ? PlanAlgoType.PLAN_2D : PlanAlgoType.PLAN_3D,
        totalDistance: result.totalDistance,
        totalDays: result.totalDays,
        dailySteps: result.dailySteps as object,
        rawPath: result.rawPath as object,
      },
    });
    await this.prisma.case.update({
      where: { id: caseId },
      data: { status: CaseStatus.PLANNED },
    });
    return plan;
  }

  /** 校验 3D 目标位姿三角形级碰撞（与 CT3D 一致，调用 algo VTK CollisionDetectionFilter） */
  async validate3dCollision(
    caseId: string,
    userId: string,
    role: Role,
    body: { targetPoses: Array<{ t: number[]; q: number[] }> },
  ): Promise<{ collisions: number[][] }> {
    const c = await this.prisma.case.findUnique({
      where: { id: caseId },
      include: { files: true },
    });
    if (!c) throw new NotFoundException('Case not found');
    if (role !== Role.ADMIN && c.doctorId !== userId) throw new ForbiddenException();

    const storageRoot = process.env.FILE_STORAGE_PATH ?? path.join(process.cwd(), 'storage');
    const allFiles = (c.files ?? []) as Array<{ id: string; type: string; path: string }>;
    const stlFiles = allFiles.filter((f) => f.type === 'STL').sort((a, b) => a.id.localeCompare(b.id));
    const stlPaths = stlFiles.map((f) => path.resolve(storageRoot, f.path));

    if (stlPaths.length < 2) {
      return { collisions: [] };
    }
    if (!Array.isArray(body.targetPoses) || body.targetPoses.length !== stlPaths.length) {
      throw new BadRequestException(
        `targetPoses 长度须与当前病例 STL 数量一致（当前 ${stlPaths.length} 个 STL）`,
      );
    }

    const target_poses = body.targetPoses.map((p) => ({
      t: Array.isArray(p.t) ? p.t.slice(0, 3) : [0, 0, 0],
      q: Array.isArray(p.q) ? p.q.slice(0, 4) : [1, 0, 0, 0],
    }));
    return this.algo.validate3dCollision({ stl_paths: stlPaths, target_poses });
  }

  /** 与 CT3D 一致：参考固定，其余顺序体素 A* 多骨规划（不落库，直接返回给前端） */
  async plan3dMulti(
    caseId: string,
    userId: string,
    role: Role,
    body: {
      refId: string;
      startPoses: Array<{ t: number[]; q: number[] }>;
      targetPoses: Array<{ t: number[]; q: number[] }>;
      max_mm?: number;
      max_deg?: number;
    },
  ) {
    try {
      const c = await this.prisma.case.findUnique({
        where: { id: caseId },
        include: { files: true },
      });
      if (!c) throw new NotFoundException('Case not found');
      if (role !== Role.ADMIN && c.doctorId !== userId) throw new ForbiddenException();

      const storageRoot = process.env.FILE_STORAGE_PATH ?? path.join(process.cwd(), 'storage');
      const allFiles = (c.files ?? []) as Array<{ id: string; type: string; path: string }>;
      const stlFiles = allFiles.filter((f) => f.type === 'STL').sort((a, b) => a.id.localeCompare(b.id));
      const stlPaths = stlFiles.map((f) => path.resolve(storageRoot, f.path ?? ''));

      if (stlPaths.length < 2) {
        throw new BadRequestException('至少需要 2 个 STL 才能进行多骨规划');
      }
      const refIndex = stlFiles.findIndex((f) => f.id === body.refId);
      if (refIndex < 0) {
        throw new BadRequestException('refId 不在当前病例 STL 列表中');
      }
      if (
        !Array.isArray(body.startPoses) ||
        !Array.isArray(body.targetPoses) ||
        body.startPoses.length !== stlPaths.length ||
        body.targetPoses.length !== stlPaths.length
      ) {
        throw new BadRequestException(
          `startPoses/targetPoses 长度须与 STL 数量一致（当前 ${stlPaths.length}）`,
        );
      }

      const start_poses = body.startPoses.map((p) => ({
        t: Array.isArray(p.t) ? p.t.slice(0, 3) : [0, 0, 0],
        q: Array.isArray(p.q) ? p.q.slice(0, 4) : [1, 0, 0, 0],
      }));
      const target_poses = body.targetPoses.map((p) => ({
        t: Array.isArray(p.t) ? p.t.slice(0, 3) : [0, 0, 0],
        q: Array.isArray(p.q) ? p.q.slice(0, 4) : [1, 0, 0, 0],
      }));

      try {
        return await this.algo.plan3dMulti({
          stl_paths: stlPaths,
          ref_index: refIndex,
          start_poses,
          target_poses,
          max_mm: body.max_mm ?? 1,
          max_deg: body.max_deg ?? 1,
        });
      } catch (algoErr) {
        if (algoErr instanceof BadGatewayException) throw algoErr;
        const msg = algoErr instanceof Error ? algoErr.message : String(algoErr);
        throw new BadGatewayException(`规划服务异常: ${msg}`);
      }
    } catch (err) {
      if (
        err instanceof NotFoundException ||
        err instanceof ForbiddenException ||
        err instanceof BadRequestException ||
        err instanceof BadGatewayException
      ) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      if (err instanceof Error && err.stack) {
        this.logger.error(`plan3dMulti error: ${msg}\n${err.stack}`);
      } else {
        this.logger.error(`plan3dMulti error: ${msg}`);
      }
      throw new InternalServerErrorException(`多骨规划失败: ${msg}`);
    }
  }

  /** 保存 3D 多骨规划到数据库（覆盖该病例下原有 PLAN_3D），并保存矫正后位姿到 meta.finalPoses 供下次读取 */
  async savePlan3d(
    caseId: string,
    userId: string,
    role: Role,
    body: {
      refId: string;
      totalDays: number;
      totalCost?: number;
      dailySteps3D: Array<{
        dayIndex: number;
        boneId: string;
        boneName?: string;
        poseMm: [number, number, number];
        deltaMm?: number;
        cumulativeMm?: number;
        rotDeg?: number;
      }>;
      planPaths: Record<string, Array<{ t: number[]; q: number[] }>>;
      planOffsets: Record<string, number>;
      planSteps: Record<string, number>;
      planOrder: string[];
      planStartPoses: Record<string, { t: number[]; q: number[] }>;
      planGoalPoses: Record<string, { t: number[]; q: number[] }>;
    },
  ) {
    const c = await this.prisma.case.findUnique({ where: { id: caseId } });
    if (!c) throw new NotFoundException('Case not found');
    if (role !== Role.ADMIN && c.doctorId !== userId) throw new ForbiddenException();

    await this.prisma.plan.deleteMany({ where: { caseId, algoType: PlanAlgoType.PLAN_3D } });

    const meta = {
      refId: body.refId,
      finalPoses: body.planGoalPoses,
      planPaths: body.planPaths,
      planOffsets: body.planOffsets,
      planSteps: body.planSteps,
      planOrder: body.planOrder,
      planStartPoses: body.planStartPoses,
      planGoalPoses: body.planGoalPoses,
    };

    const plan = await this.prisma.plan.create({
      data: {
        caseId,
        algoType: PlanAlgoType.PLAN_3D,
        totalDistance: body.totalCost ?? 0,
        totalDays: body.totalDays,
        dailySteps: body.dailySteps3D as object,
        rawPath: Prisma.JsonNull,
        meta: meta as object,
      },
    });
    await this.prisma.case.update({
      where: { id: caseId },
      data: { status: CaseStatus.PLANNED },
    });
    return plan;
  }

  async update(
    planId: string,
    userId: string,
    role: Role,
    body: { totalDays?: number; totalDistance?: number; dailySteps?: object; rawPath?: object; meta?: object },
  ) {
    const plan = await this.prisma.plan.findUnique({ where: { id: planId }, include: { case: true } });
    if (!plan) throw new NotFoundException('Plan not found');
    if (role !== Role.ADMIN && plan.case.doctorId !== userId) throw new ForbiddenException();
    const data: { totalDays?: number; totalDistance?: number; dailySteps?: object; rawPath?: object; meta?: object } = {};
    if (body.totalDays != null) data.totalDays = body.totalDays;
    if (body.totalDistance != null) data.totalDistance = body.totalDistance;
    if (body.dailySteps != null) data.dailySteps = body.dailySteps;
    if (body.rawPath != null) data.rawPath = body.rawPath;
    if (body.meta != null) data.meta = body.meta;
    return this.prisma.plan.update({ where: { id: planId }, data });
  }

  /** 计算固定架预设刻度：泰勒架公式 + 测量结果 + 器械配置，返回 6 条杆刻度与杆长（1 刻度 = 1mm） */
  async calculateScales(
    caseId: string,
    userId: string,
    role: Role,
    body: {
      measurementId?: string;
      measurementSummary?: MeasurementSummary;
      instrumentConfig: InstrumentConfigInput;
    },
  ): Promise<{ rods: RodScaleResult[] }> {
    const c = await this.prisma.case.findUnique({ where: { id: caseId } });
    if (!c) throw new NotFoundException('Case not found');
    if (role !== Role.ADMIN && c.doctorId !== userId) throw new ForbiddenException();

    let summary: MeasurementSummary = body.measurementSummary ?? {};
    if (body.measurementId) {
      const m = await this.prisma.measurement.findFirst({ where: { id: body.measurementId, caseId } });
      if (m && m.values && typeof m.values === 'object') {
        const v = m.values as Record<string, number>;
        summary = {
          anklePlantarflexion: v.anklePlantarflexion ?? v.踝关节跖屈角度,
          footEversion: v.footEversion ?? v.足内外翻角度,
          calcanealForceLine: v.calcanealForceLine ?? v.跟骨力线,
          calcanealEversion: v.calcanealEversion ?? v.跟骨内外翻角度,
          archHeight: v.archHeight ?? v.足弓高度,
        };
      }
    }

    let ringDiameterMm = 180;
    const baseRodLengths: number[] = [];
    if (body.instrumentConfig.referenceRingId) {
      try {
        const ring = await this.instruments.findRingById(body.instrumentConfig.referenceRingId);
        if (ring.diameterMm != null) ringDiameterMm = ring.diameterMm;
      } catch {
        /* use default */
      }
    }
    const rodIds = body.instrumentConfig.rodIds ?? [];
    for (let i = 0; i < 6; i++) {
      const id = rodIds[i];
      if (id) {
        try {
          const rod = await this.instruments.findRodById(id);
          baseRodLengths.push(rod.lengthMm ?? 155);
        } catch {
          baseRodLengths.push(155);
        }
      } else {
        baseRodLengths.push(155);
      }
    }
    while (baseRodLengths.length < 6) baseRodLengths.push(155);

    const rods = this.taylor.calculateScales(summary, body.instrumentConfig, ringDiameterMm, baseRodLengths);
    return { rods };
  }

  async ratioBall(payload: { image_path?: string; image_base64?: string }) {
    return this.algo.ratioBall(payload);
  }

  async stlTo2d(payload: { case_id?: string; stl_paths?: string[] }) {
    return this.algo.stlTo2d(payload);
  }

  async exportPlanPdf(planId: string, userId: string, role: Role): Promise<{ stream: NodeJS.ReadableStream; filename: string }> {
    const plan = await this.prisma.plan.findUnique({
      where: { id: planId },
      include: { case: { include: { patient: true, doctor: true } } },
    });
    if (!plan) throw new NotFoundException('Plan not found');
    const c = plan.case;
    if (role === Role.ADMIN) {}
    else if (role === Role.DOCTOR && c.doctorId !== userId) throw new ForbiddenException();
    else if (role === Role.PATIENT) {
      const patient = await this.prisma.patient.findFirst({ where: { userId } });
      if (!patient || c.patientId !== patient.id) throw new ForbiddenException();
    }

    let PDFDocument: any;
    const tryLoad = (pkg: unknown) => (typeof pkg === 'function' ? pkg : (pkg as { default?: unknown })?.default ?? pkg);
    const dirs = [
      process.cwd(),
      path.resolve(process.cwd(), 'apps', 'api'),
      path.resolve(__dirname, '..'),
    ];
    for (const dir of dirs) {
      try {
        const req = createRequire(path.resolve(dir, 'package.json'));
        PDFDocument = tryLoad(req('pdfkit'));
        if (PDFDocument) break;
      } catch {
        /* 尝试下一目录 */
      }
    }
    if (!PDFDocument) {
      try {
        PDFDocument = tryLoad(require('pdfkit'));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new InternalServerErrorException(
          `PDF 需要 pdfkit。请进入 apps/api 执行: npm install。原始错误: ${msg}`,
        );
      }
    }

    try {
      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const filename = `plan-${String(plan.id)}.pdf`;

      // 中文字体：必须加载支持中文的字体，否则 PDF 中文会乱码
      const sysRoot = (process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows').replace(/\//g, path.sep);
      const cwd = process.cwd();
      const apiRoot = cwd.endsWith('api') || cwd.endsWith(path.sep + 'api') ? cwd : path.resolve(cwd, 'apps', 'api');
      const distRoot = path.resolve(__dirname, '..', '..');
      const fontCandidates: string[] = [
        path.resolve(apiRoot, 'fonts', 'simsun.ttc'),
        path.resolve(apiRoot, 'fonts', 'msyh.ttc'),
        path.resolve(apiRoot, 'fonts', 'simsunb.ttf'),   // SimSun-ExtB
        path.resolve(apiRoot, 'fonts', 'simsung.ttf'),  // SimSun-ExtG
        path.resolve(distRoot, 'fonts', 'simsun.ttc'),
        path.resolve(distRoot, 'fonts', 'msyh.ttc'),
        path.resolve(process.cwd(), 'fonts', 'simsun.ttc'),
        path.resolve(process.cwd(), 'fonts', 'msyh.ttc'),
        path.resolve(process.cwd(), 'fonts', 'simsunb.ttf'),
        path.resolve(process.cwd(), 'fonts', 'simsung.ttf'),
        'C:\\Windows\\Fonts\\simsun.ttc',
        'C:\\Windows\\Fonts\\SimSun.ttc',
        'C:\\Windows\\Fonts\\simsunb.ttf',
        'C:\\Windows\\Fonts\\simsung.ttf',
        'C:\\Windows\\Fonts\\msyh.ttc',
        path.resolve(sysRoot, 'Fonts', 'simsun.ttc'),
        path.resolve(sysRoot, 'Fonts', 'msyh.ttc'),
      ];
      let fontPath: string | null = null;
      for (const p of fontCandidates) {
        const normalized = path.normalize(p);
        try {
          if (fs.existsSync(normalized)) {
            fontPath = normalized;
            break;
          }
        } catch {
          /* skip */
        }
      }
      if (fontPath) {
        const fontBuffer = fs.readFileSync(fontPath);
        const ext = path.extname(fontPath).toLowerCase();
        const isTtc = ext === '.ttc';
        // TTC 是字体集合，必须指定 postscript 名称才能选中中文字体，否则会选到拉丁子字体导致乱码
        const ttcPostscriptNames = ['SimSun', 'SimSun-ExtB', 'SimSun-ExtG', 'Microsoft YaHei'];
        let fontSet = false;
        if (isTtc && fontBuffer) {
          for (const postscriptName of ttcPostscriptNames) {
            try {
              doc.registerFont('Chinese', fontBuffer, postscriptName);
              doc.font('Chinese');
              fontSet = true;
              break;
            } catch {
              /* 尝试下一个 postscript 名 */
            }
          }
        }
        if (!fontSet) {
          try {
            doc.registerFont('Chinese', fontBuffer);
            doc.font('Chinese');
            fontSet = true;
          } catch {
            try {
              doc.registerFont('Chinese', fontPath, isTtc ? 'SimSun' : undefined);
              doc.font('Chinese');
              fontSet = true;
            } catch {
              try {
                doc.font(fontPath);
                fontSet = true;
              } catch {
                /* 仍失败则中文会乱码 */
              }
            }
          }
        }
      }

      const margin = 50;
      let y = margin;

      // 标题
      doc.fontSize(20).text('足踝畸形矫正规划报告', margin, y, { align: 'center', width: doc.page.width - margin * 2 });
      y += 32;

      // 基本信息
      doc.fontSize(11);
      doc.text('病例编号：', margin, y); doc.text(String(c.id), margin + 70, y);
      y += 22;
      doc.text('患者姓名：', margin, y); doc.text(String(c.patient?.name ?? '—'), margin + 70, y);
      y += 20;
      doc.text('责任医生：', margin, y); doc.text(String(c.doctor?.name ?? '—'), margin + 70, y);
      y += 20;
      doc.text('规划类型：', margin, y); doc.text(plan.algoType === PlanAlgoType.PLAN_2D ? '2D' : '3D', margin + 70, y);
      y += 20;
      doc.text('总矫正距离：', margin, y); doc.text(`${String(plan.totalDistance ?? '—')} mm`, margin + 70, y);
      y += 20;
      doc.text('总天数：', margin, y); doc.text(`${String(plan.totalDays ?? '—')} 天`, margin + 70, y);
      y += 28;

      // 每日步进表格
      doc.fontSize(11).text('每日步进', margin, y);
      y += 22;

      const dailySteps = (plan.dailySteps as Array<{ dayIndex?: number; poseMm?: number[]; deltaMm?: number; cumulativeMm?: number }> | null) ?? [];
      const cols = [
        { w: 40, title: '日序' },
        { w: 122, title: '位姿 (左右, 上下, 前后) mm' },
        { w: 56, title: '当日增量 mm' },
        { w: 56, title: '累计 mm' },
      ];
      const rowHeight = 20;
      const tableLeft = margin;
      const tableWidth = cols.reduce((a, x) => a + x.w, 0);

      doc.fontSize(9);
      let x = tableLeft;
      cols.forEach((col) => {
        doc.rect(x, y, col.w, rowHeight).stroke();
        doc.text(col.title, x + 4, y + 5, { width: col.w - 6 });
        x += col.w;
      });
      y += rowHeight;

      const steps = dailySteps.slice(0, 35);
      steps.forEach((step) => {
        const dayIdx = step.dayIndex ?? 0;
        const pose = step.poseMm ?? [0, 0, 0];
        const poseStr = `${Number(pose[0]).toFixed(3)}, ${Number(pose[1]).toFixed(3)}, ${Number(pose[2]).toFixed(3)}`;
        const delta = typeof step.deltaMm === 'number' ? step.deltaMm.toFixed(3) : '—';
        const cum = typeof step.cumulativeMm === 'number' ? step.cumulativeMm.toFixed(3) : '—';
        x = tableLeft;
        doc.rect(x, y, cols[0].w, rowHeight).stroke();
        doc.text(String(dayIdx), x + 4, y + 5, { width: cols[0].w - 6 });
        x += cols[0].w;
        doc.rect(x, y, cols[1].w, rowHeight).stroke();
        doc.text(poseStr, x + 4, y + 5, { width: cols[1].w - 6 });
        x += cols[1].w;
        doc.rect(x, y, cols[2].w, rowHeight).stroke();
        doc.text(delta, x + 4, y + 5, { width: cols[2].w - 6 });
        x += cols[2].w;
        doc.rect(x, y, cols[3].w, rowHeight).stroke();
        doc.text(cum, x + 4, y + 5, { width: cols[3].w - 6 });
        y += rowHeight;
        if (y > doc.page.height - 60) {
          doc.addPage();
          y = margin;
        }
      });

      if (dailySteps.length > 35) {
        doc.fontSize(9).text(`（以上为前 35 步，共 ${dailySteps.length} 步）`, margin, y + 6);
      }

      doc.end();
      return { stream: doc as NodeJS.ReadableStream, filename };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new InternalServerErrorException(`PDF 生成失败: ${msg}`);
    }
  }

  /** 3D 规划报告 PDF：格式与二维规划设计一致，表格列为 日序 | 骨 | 位姿(x,y,z) mm | 当日平移 mm | 累计平移 mm | 当日旋转 ° */
  async exportPlanPdf3D(
    caseId: string,
    userId: string,
    role: Role,
    body: {
      totalDays: number;
      totalCost?: number;
      dailySteps3D: Array<{
        dayIndex: number;
        boneId: string;
        boneName?: string;
        poseMm: [number, number, number];
        deltaMm?: number;
        cumulativeMm?: number;
        rotDeg?: number;
      }>;
    },
  ): Promise<{ stream: NodeJS.ReadableStream; filename: string }> {
    const c = await this.prisma.case.findUnique({
      where: { id: caseId },
      include: { patient: true, doctor: true },
    });
    if (!c) throw new NotFoundException('Case not found');
    if (role !== Role.ADMIN && c.doctorId !== userId) throw new ForbiddenException();

    let PDFDocument: any;
    const tryLoad = (pkg: unknown) => (typeof pkg === 'function' ? pkg : (pkg as { default?: unknown })?.default ?? pkg);
    const dirs = [process.cwd(), path.resolve(process.cwd(), 'apps', 'api'), path.resolve(__dirname, '..')];
    for (const dir of dirs) {
      try {
        const req = createRequire(path.resolve(dir, 'package.json'));
        PDFDocument = tryLoad(req('pdfkit'));
        if (PDFDocument) break;
      } catch {
        /* skip */
      }
    }
    if (!PDFDocument) {
      try {
        PDFDocument = tryLoad(require('pdfkit'));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new InternalServerErrorException(`PDF 需要 pdfkit。原始错误: ${msg}`);
      }
    }

    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const filename = `plan-3d-${caseId}.pdf`;
    const sysRoot = (process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows').replace(/\//g, path.sep);
    const cwd = process.cwd();
    const apiRoot = cwd.endsWith('api') || cwd.endsWith(path.sep + 'api') ? cwd : path.resolve(cwd, 'apps', 'api');
    const distRoot = path.resolve(__dirname, '..', '..');
    const fontCandidates: string[] = [
      path.resolve(apiRoot, 'fonts', 'simsun.ttc'),
      path.resolve(apiRoot, 'fonts', 'msyh.ttc'),
      path.resolve(distRoot, 'fonts', 'simsun.ttc'),
      'C:\\Windows\\Fonts\\simsun.ttc',
      path.resolve(sysRoot, 'Fonts', 'simsun.ttc'),
    ];
    for (const p of fontCandidates) {
      try {
        if (fs.existsSync(path.normalize(p))) {
          doc.registerFont('Chinese', path.normalize(p), 'SimSun');
          doc.font('Chinese');
          break;
        }
      } catch {
        /* skip */
      }
    }

    const margin = 50;
    let y = margin;

    doc.fontSize(20).text('足踝畸形矫正规划报告', margin, y, { align: 'center', width: doc.page.width - margin * 2 });
    y += 32;
    doc.fontSize(11);
    doc.text('病例编号：', margin, y);
    doc.text(String(c.id), margin + 70, y);
    y += 22;
    doc.text('患者姓名：', margin, y);
    doc.text(String(c.patient?.name ?? '—'), margin + 70, y);
    y += 20;
    doc.text('责任医生：', margin, y);
    doc.text(String(c.doctor?.name ?? '—'), margin + 70, y);
    y += 20;
    doc.text('规划类型：', margin, y);
    doc.text('3D（体素A*）', margin + 70, y);
    y += 20;
    doc.text('总天数：', margin, y);
    doc.text(`${body.totalDays} 天`, margin + 70, y);
    y += 20;
    if (body.totalCost != null) {
      doc.text('总代价：', margin, y);
      doc.text(body.totalCost.toFixed(2), margin + 70, y);
      y += 20;
    }
    y += 28;

    doc.fontSize(11).text('每日步进', margin, y);
    y += 22;

    const dailySteps3D = body.dailySteps3D ?? [];
    const cols = [
      { w: 36, title: '日序' },
      { w: 52, title: '骨' },
      { w: 110, title: '位姿 (x,y,z) mm' },
      { w: 52, title: '当日平移 mm' },
      { w: 52, title: '累计 mm' },
      { w: 52, title: '当日旋转 °' },
    ];
    const rowHeight = 20;
    const tableLeft = margin;

    doc.fontSize(9);
    let x = tableLeft;
    cols.forEach((col) => {
      doc.rect(x, y, col.w, rowHeight).stroke();
      doc.text(col.title, x + 4, y + 5, { width: col.w - 6 });
      x += col.w;
    });
    y += rowHeight;

    const steps = dailySteps3D.slice(0, 80);
    steps.forEach((step) => {
      const poseStr = `${Number(step.poseMm[0]).toFixed(3)}, ${Number(step.poseMm[1]).toFixed(3)}, ${Number(step.poseMm[2]).toFixed(3)}`;
      const delta = typeof step.deltaMm === 'number' ? step.deltaMm.toFixed(3) : '—';
      const cum = typeof step.cumulativeMm === 'number' ? step.cumulativeMm.toFixed(3) : '—';
      const rot = typeof step.rotDeg === 'number' ? step.rotDeg.toFixed(3) : '—';
      const boneName = (step.boneName ?? step.boneId).slice(0, 8);
      x = tableLeft;
      doc.rect(x, y, cols[0].w, rowHeight).stroke();
      doc.text(String(step.dayIndex), x + 4, y + 5, { width: cols[0].w - 6 });
      x += cols[0].w;
      doc.rect(x, y, cols[1].w, rowHeight).stroke();
      doc.text(boneName, x + 4, y + 5, { width: cols[1].w - 6 });
      x += cols[1].w;
      doc.rect(x, y, cols[2].w, rowHeight).stroke();
      doc.text(poseStr, x + 4, y + 5, { width: cols[2].w - 6 });
      x += cols[2].w;
      doc.rect(x, y, cols[3].w, rowHeight).stroke();
      doc.text(delta, x + 4, y + 5, { width: cols[3].w - 6 });
      x += cols[3].w;
      doc.rect(x, y, cols[4].w, rowHeight).stroke();
      doc.text(cum, x + 4, y + 5, { width: cols[4].w - 6 });
      x += cols[4].w;
      doc.rect(x, y, cols[5].w, rowHeight).stroke();
      doc.text(rot, x + 4, y + 5, { width: cols[5].w - 6 });
      y += rowHeight;
      if (y > doc.page.height - 60) {
        doc.addPage();
        y = margin;
      }
    });

    if (dailySteps3D.length > 80) {
      doc.fontSize(9).text(`（以上为前 80 步，共 ${dailySteps3D.length} 步）`, margin, y + 6);
    }

    doc.end();
    return { stream: doc as NodeJS.ReadableStream, filename };
  }
}
