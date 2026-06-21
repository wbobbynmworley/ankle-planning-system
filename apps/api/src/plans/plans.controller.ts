import { Body, Controller, Get, Param, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Request, Response } from 'express';
import { PlansService } from './plans.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('plans')
@UseGuards(JwtAuthGuard)
export class PlansController {
  constructor(private plans: PlansService) {}

  @Get('algo-health')
  async algoHealth() {
    return this.plans.checkAlgoHealth();
  }

  @Get('case/:caseId')
  async listByCase(@Param('caseId') caseId: string, @Req() req: Request) {
    const user = (req as any).user;
    return this.plans.findForCase(caseId, user.id, user.role);
  }

  @Post('save-plan-3d')
  @UseGuards(RolesGuard)
  @Roles('DOCTOR', 'ADMIN')
  async savePlan3d(
    @Body()
    body: {
      caseId: string;
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
    @Req() req: Request,
  ) {
    const user = (req as any).user;
    return this.plans.savePlan3d(body.caseId, user.id, user.role, {
      refId: body.refId,
      totalDays: body.totalDays,
      totalCost: body.totalCost,
      dailySteps3D: body.dailySteps3D,
      planPaths: body.planPaths,
      planOffsets: body.planOffsets,
      planSteps: body.planSteps,
      planOrder: body.planOrder,
      planStartPoses: body.planStartPoses,
      planGoalPoses: body.planGoalPoses,
    });
  }

  @Post('export-pdf-3d')
  @UseGuards(RolesGuard)
  @Roles('DOCTOR', 'ADMIN')
  async exportPdf3D(
    @Body()
    body: {
      caseId: string;
      totalDays: number;
      totalCost?: number;
      dailySteps3D: Array<{
        dayIndex: number;
        boneId: string;
        boneName?: string;
        poseMm: [number, number, number];
        deltaMm?: number;
        cumulativeMm?: number;
      }>;
    },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const user = (req as any).user;
    const { stream, filename } = await this.plans.exportPlanPdf3D(
      body.caseId,
      user.id,
      user.role,
      { totalDays: body.totalDays, totalCost: body.totalCost, dailySteps3D: body.dailySteps3D },
    );
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    stream.pipe(res);
  }

  @Get(':id/pdf')
  async exportPdf(@Param('id') id: string, @Req() req: Request, @Res() res: Response) {
    const user = (req as any).user;
    const { stream, filename } = await this.plans.exportPlanPdf(id, user.id, user.role);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    stream.pipe(res);
  }

  @Get(':id')
  async one(@Param('id') id: string, @Req() req: Request) {
    const user = (req as any).user;
    return this.plans.findOne(id, user.id, user.role);
  }

  @Post('segmentation/predict')
  @UseGuards(RolesGuard)
  @Roles('DOCTOR', 'ADMIN')
  async segmentationPredict(
    @Body() body: { image_base64: string; box: [number, number, number, number] },
    @Req() req: Request,
  ) {
    return this.plans.segmentationPredict(body);
  }

  @Post('segmentation/save-mask')
  @UseGuards(RolesGuard)
  @Roles('DOCTOR', 'ADMIN')
  async saveMask(
    @Body() body: { caseId: string; view_key: string; role: string; engine_name: string; mask_base64: string },
    @Req() req: Request,
  ) {
    const user = (req as any).user;
    return this.plans.saveMask(body.caseId, user.id, user.role, {
      view_key: body.view_key,
      role: body.role,
      engine_name: body.engine_name,
      mask_base64: body.mask_base64,
    });
  }

  @Post('segmentation/load-mask')
  @UseGuards(RolesGuard)
  @Roles('DOCTOR', 'ADMIN')
  async loadMask(
    @Body() body: { path: string },
    @Req() req: Request,
  ) {
    const user = (req as any).user;
    return this.plans.loadSavedMask(body.path, user.id, user.role);
  }

  @Post('validate-3d-collision')
  @UseGuards(RolesGuard)
  @Roles('DOCTOR', 'ADMIN')
  async validate3dCollision(
    @Body() body: { caseId: string; targetPoses: Array<{ t: number[]; q: number[] }> },
    @Req() req: Request,
  ) {
    const user = (req as any).user;
    return this.plans.validate3dCollision(body.caseId, user.id, user.role, { targetPoses: body.targetPoses });
  }

  @Post('plan-3d-multi')
  @UseGuards(RolesGuard)
  @Roles('DOCTOR', 'ADMIN')
  async plan3dMulti(
    @Body()
    body: {
      caseId: string;
      refId: string;
      startPoses: Array<{ t: number[]; q: number[] }>;
      targetPoses: Array<{ t: number[]; q: number[] }>;
      max_mm?: number;
      max_deg?: number;
    },
    @Req() req: Request,
  ) {
    const user = (req as any).user;
    return this.plans.plan3dMulti(body.caseId, user.id, user.role, {
      refId: body.refId,
      startPoses: body.startPoses,
      targetPoses: body.targetPoses,
      max_mm: body.max_mm,
      max_deg: body.max_deg,
    });
  }

  @Post('trigger')
  @UseGuards(RolesGuard)
  @Roles('DOCTOR', 'ADMIN')
  async trigger(
    @Body()
    body: {
      caseId: string;
      algoType: '2d' | '3d';
      startMm?: number[];
      goalMm?: number[];
      frontMmPerPx?: number;
      sideMmPerPx?: number;
      frontRefMaskPath?: string;
      frontMovMaskPath?: string;
      sideRefMaskPath?: string;
      sideMovMaskPath?: string;
    },
    @Req() req: Request,
  ) {
    const user = (req as any).user;
    const { caseId, algoType, startMm, goalMm, frontMmPerPx, sideMmPerPx, frontRefMaskPath, frontMovMaskPath, sideRefMaskPath, sideMovMaskPath } = body;
    return this.plans.triggerPlan(caseId, user.id, user.role, algoType, {
      startMm,
      goalMm,
      frontMmPerPx,
      sideMmPerPx,
      frontRefMaskPath,
      frontMovMaskPath,
      sideRefMaskPath,
      sideMovMaskPath,
    });
  }

  @Post('calculate-scales')
  @UseGuards(RolesGuard)
  @Roles('DOCTOR', 'ADMIN')
  async calculateScales(
    @Body()
    body: {
      caseId: string;
      measurementId?: string;
      measurementSummary?: Record<string, number>;
      instrumentConfig: {
        referenceRingId?: string;
        movingRingId?: string;
        rotationDirection?: '内旋' | '外旋';
        rotationAngle?: number;
        rodIds?: string[];
        combinationId?: string;
      };
    },
    @Req() req: Request,
  ) {
    const user = (req as any).user;
    return this.plans.calculateScales(body.caseId, user.id, user.role, {
      measurementId: body.measurementId,
      measurementSummary: body.measurementSummary,
      instrumentConfig: body.instrumentConfig,
    });
  }

  @Post('ratio-ball')
  @UseGuards(RolesGuard)
  @Roles('DOCTOR', 'ADMIN')
  async ratioBall(
    @Body() body: { image_path?: string; image_base64?: string },
    @Req() req: Request,
  ) {
    return this.plans.ratioBall(body);
  }

  @Post('stl-to-2d')
  @UseGuards(RolesGuard)
  @Roles('DOCTOR', 'ADMIN')
  async stlTo2d(
    @Body() body: { case_id?: string; stl_paths?: string[] },
    @Req() req: Request,
  ) {
    return this.plans.stlTo2d(body);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('DOCTOR', 'ADMIN')
  async update(
    @Param('id') id: string,
    @Body() body: { totalDays?: number; totalDistance?: number; dailySteps?: object; rawPath?: object; meta?: object },
    @Req() req: Request,
  ) {
    const user = (req as any).user;
    return this.plans.update(id, user.id, user.role, body);
  }
}
