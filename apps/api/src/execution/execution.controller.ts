import { Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { ExecutionService } from './execution.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('execution')
@UseGuards(JwtAuthGuard)
export class ExecutionController {
  constructor(private execution: ExecutionService) {}

  @Get('patients')
  async listPatients(@Req() req: Request) {
    const user = (req as any).user;
    return this.execution.listPatients(user.id, user.role);
  }

  /**
   * 患者记录当日矫正执行步数
   * body: { caseId, stepIndex, completed, actualSteps?, note? }
   */
  @Post('record')
  async recordExecution(
    @Body() body: { caseId: string; stepIndex: number; completed?: boolean; actualSteps?: number; note?: string },
    @Req() req: Request,
  ) {
    const user = (req as any).user;
    return this.execution.recordPatientExecution(
      body.caseId,
      body.stepIndex,
      user.id,
      body.completed ?? true,
      body.actualSteps,
      body.note,
    );
  }

  /**
   * 患者获取自己的治疗进度概览
   */
  @Get('progress/overview')
  async getProgressOverview(@Req() req: Request) {
    const user = (req as any).user;
    return this.execution.getPatientProgressOverview(user.id);
  }

  @Get('plan/:caseId')
  async getPlan(@Param('caseId') caseId: string, @Req() req: Request) {
    const user = (req as any).user;
    return this.execution.getPlanByCaseId(caseId, user.id, user.role);
  }

  @Patch('plan/:caseId/steps/:stepIndex')
  async updateStep(
    @Param('caseId') caseId: string,
    @Param('stepIndex') stepIndex: string,
    @Body() body: {
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
    @Req() req: Request,
  ) {
    const user = (req as any).user;
    const idx = parseInt(stepIndex, 10);
    if (Number.isNaN(idx) || idx < 1) throw new Error('Invalid stepIndex');
    return this.execution.updateStep(caseId, idx, user.id, user.role, body);
  }
}
