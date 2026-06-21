import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { MeasurementsService } from './measurements.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { MeasurementStage } from '@prisma/client';

@Controller('measurements')
@UseGuards(JwtAuthGuard)
export class MeasurementsController {
  constructor(private measurements: MeasurementsService) {}

  @Post()
  @UseGuards(RolesGuard)
  @Roles('DOCTOR', 'ADMIN')
  async create(
    @Body() body: { caseId: string; stage: string; viewKey?: string; values: Record<string, number | string> },
    @Req() req: Request,
  ) {
    const user = (req as any).user;
    const stage = body.stage as MeasurementStage;
    if (!['PREOP_2D', 'PREOP_3D', 'POSTOP_2D', 'POSTOP_3D'].includes(stage)) {
      throw new Error('Invalid stage');
    }
    return this.measurements.create(user.id, user.role, {
      caseId: body.caseId,
      stage,
      viewKey: body.viewKey,
      values: body.values,
    });
  }

  @Get()
  @UseGuards(RolesGuard)
  @Roles('DOCTOR', 'ADMIN', 'PATIENT')
  async list(
    @Query('caseId') caseId: string,
    @Query('stage') stage: string,
    @Req() req: Request,
  ) {
    const user = (req as any).user;
    if (!caseId || !stage) throw new Error('caseId and stage required');
    const s = stage as MeasurementStage;
    if (!['PREOP_2D', 'PREOP_3D', 'POSTOP_2D', 'POSTOP_3D'].includes(s)) {
      throw new Error('Invalid stage');
    }
    return this.measurements.findByCaseAndStage(caseId, s, user.id, user.role);
  }

  @Get(':id')
  async one(@Param('id') id: string, @Req() req: Request) {
    const user = (req as any).user;
    return this.measurements.findOne(id, user.id, user.role);
  }
}
