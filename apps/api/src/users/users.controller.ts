import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { BulkImportDoctorsDto } from '../auth/dto/bulk-import-doctors.dto';
import { Role } from '@prisma/client';

@Controller('users')
@UseGuards(JwtAuthGuard)
export class UsersController {
  constructor(private users: UsersService) {}

  @Get()
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'DOCTOR')
  async list(@Query('role') role?: string, @Req() req?: Request) {
    const user = req ? (req as any).user : null;
    let roleFilter: Role | undefined = role && ['ADMIN', 'DOCTOR', 'PATIENT'].includes(role) ? (role as Role) : undefined;
    if (user?.role === 'DOCTOR') roleFilter = Role.PATIENT;
    return this.users.findAll(roleFilter);
  }

  @Post('bulk-import-doctors')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async bulkImportDoctors(@Body() body: BulkImportDoctorsDto) {
    return this.users.bulkImportDoctors(body.rows);
  }
}
