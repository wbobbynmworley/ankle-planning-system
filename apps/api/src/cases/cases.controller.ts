import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFiles,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { Request } from 'express';
import { CasesService } from './cases.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('cases')
@UseGuards(JwtAuthGuard)
export class CasesController {
  constructor(private cases: CasesService) {}

  @Get('for-planning')
  async listForPlanning(@Req() req: Request) {
    const user = (req as any).user;
    return this.cases.findForPlanning(user.id, user.role);
  }

  @Get()
  async list(
    @Req() req: Request,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const user = (req as any).user;
    return this.cases.findForUser(user.id, user.role, {
      search,
      status,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get(':id')
  async one(@Param('id') id: string, @Req() req: Request) {
    const user = (req as any).user;
    return this.cases.findOne(id, user.id, user.role);
  }

  @Post()
  @UseGuards(RolesGuard)
  @Roles('DOCTOR', 'ADMIN')
  async create(
    @Body() body: { patientName: string; patientIdNumber: string; description?: string },
    @Req() req: Request,
  ) {
    const user = (req as any).user;
    return this.cases.create(user.id, {
      patientName: body.patientName,
      patientIdNumber: body.patientIdNumber,
      description: body.description,
    });
  }

  /** 创建病例并上传影像（STL 和/或 正位图、侧位图），至少传一种 */
  @Post('with-files')
  @UseGuards(RolesGuard)
  @Roles('DOCTOR', 'ADMIN')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'stl', maxCount: 1 },
        { name: 'front', maxCount: 1 },
        { name: 'side', maxCount: 1 },
      ],
      { limits: { fileSize: 100 * 1024 * 1024 } },
    ),
  )
  async createWithFiles(
    @Req() req: Request,
    @UploadedFiles()
    files: { stl?: Express.Multer.File[]; front?: Express.Multer.File[]; side?: Express.Multer.File[] },
  ) {
    const user = (req as any).user;
    const body = req.body as { patientName?: string; patientIdNumber?: string; description?: string };
    return this.cases.createWithFiles(user.id, user.role, {
      patientName: body.patientName ?? '',
      patientIdNumber: body.patientIdNumber ?? '',
      description: body.description,
    }, files);
  }

  @Patch(':id')
  @UseGuards(RolesGuard)
  @Roles('DOCTOR', 'ADMIN')
  async update(
    @Param('id') id: string,
    @Body() body: { status?: string; description?: string },
    @Req() req: Request,
  ) {
    const user = (req as any).user;
    return this.cases.update(id, user.id, user.role, body);
  }

  @Delete(':id')
  @UseGuards(RolesGuard)
  @Roles('DOCTOR', 'ADMIN')
  async remove(@Param('id') id: string, @Req() req: Request) {
    const user = (req as any).user;
    return this.cases.remove(id, user.id, user.role);
  }
}
