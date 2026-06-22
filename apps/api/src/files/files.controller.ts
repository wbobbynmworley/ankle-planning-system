import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';
import { FilesService } from './files.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { FileType } from '@prisma/client';

@Controller('files')
@UseGuards(JwtAuthGuard)
export class FilesController {
  constructor(private files: FilesService) {}

  @Post('upload/:caseId')
  @UseGuards(RolesGuard)
  @Roles('DOCTOR', 'ADMIN')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 100 * 1024 * 1024 },
    }),
  )
  async upload(
    @Param('caseId') caseId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request,
  ) {
    if (!file) throw new Error('No file uploaded');
    const user = (req as any).user;
    const typeOverride = (req as any).body?.type as FileType | undefined;
    return this.files.upload(caseId, user.id, user.role, file, typeOverride);
  }

  @Get('case/:caseId')
  async listByCase(@Param('caseId') caseId: string, @Req() req: Request) {
    const user = (req as any).user;
    return this.files.listByCase(caseId, user.id, user.role);
  }

  @Get('download/:fileId')
  async download(@Param('fileId') fileId: string, @Req() req: Request, @Res() res: Response) {
    const user = (req as any).user;
    const { buffer, originalName, mimeType } = await this.files.getContent(fileId, user.id, user.role);
    res.setHeader('Content-Type', mimeType || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(originalName)}"`,
    );
    res.send(buffer);
  }

  @Delete(':fileId')
  @UseGuards(RolesGuard)
  @Roles('DOCTOR', 'ADMIN')
  async delete(@Param('fileId') fileId: string, @Req() req: Request) {
    const user = (req as any).user;
    return this.files.deleteFile(fileId, user.id, user.role);
  }
}
