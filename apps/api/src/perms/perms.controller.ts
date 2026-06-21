import { Body, Controller, Get, Put, Query, UseGuards } from '@nestjs/common';
import { PermsService } from './perms.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('perms')
@UseGuards(JwtAuthGuard)
@UseGuards(RolesGuard)
@Roles('ADMIN')
export class PermsController {
  constructor(private perms: PermsService) {}

  @Get('roles')
  async listRoles() {
    return this.perms.listRoles();
  }

  @Get('function')
  async getFunction(@Query('role') role?: string) {
    return this.perms.getFunctionPermissions(role);
  }

  @Put('function')
  async setFunction(
    @Body() body: { role: string; permissions: Array<{ resource: string; action: string; allowed: boolean }> },
  ) {
    return this.perms.setFunctionPermissions(body.role, body.permissions);
  }

  @Get('data')
  async getData(@Query('role') role?: string) {
    return this.perms.getDataPermissions(role);
  }

  @Put('data')
  async setData(@Body() body: { role: string; scope: string; resource?: string }) {
    return this.perms.setDataPermissions(body.role, body.scope, body.resource);
  }
}
