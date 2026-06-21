import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { InstrumentsService } from './instruments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';

@Controller('instruments')
@UseGuards(JwtAuthGuard)
export class InstrumentsController {
  constructor(private instruments: InstrumentsService) {}

  @Get('rings')
  async listRings(@Query('active') active?: string) {
    return this.instruments.findAllRings(active !== 'false');
  }

  @Get('rings/:id')
  async getRing(@Param('id') id: string) {
    return this.instruments.findRingById(id);
  }

  @Post('rings')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'DOCTOR')
  async createRing(
    @Body() body: { name: string; code: string; diameterMm?: number; spec?: object },
  ) {
    return this.instruments.createRing(body);
  }

  @Patch('rings/:id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'DOCTOR')
  async updateRing(
    @Param('id') id: string,
    @Body() body: { name?: string; code?: string; diameterMm?: number; spec?: object; isActive?: boolean },
  ) {
    return this.instruments.updateRing(id, body);
  }

  @Get('rods')
  async listRods(@Query('active') active?: string) {
    return this.instruments.findAllRods(active !== 'false');
  }

  @Get('rods/:id')
  async getRod(@Param('id') id: string) {
    return this.instruments.findRodById(id);
  }

  @Post('rods')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'DOCTOR')
  async createRod(
    @Body() body: { name: string; code: string; lengthMm?: number; spec?: object },
  ) {
    return this.instruments.createRod(body);
  }

  @Patch('rods/:id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'DOCTOR')
  async updateRod(
    @Param('id') id: string,
    @Body() body: { name?: string; code?: string; lengthMm?: number; spec?: object; isActive?: boolean },
  ) {
    return this.instruments.updateRod(id, body);
  }

  @Get('combinations')
  async listCombinations(@Query('active') active?: string) {
    return this.instruments.findAllCombinations(active !== 'false');
  }

  @Get('combinations/:id')
  async getCombination(@Param('id') id: string) {
    return this.instruments.findCombinationById(id);
  }

  @Post('combinations')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'DOCTOR')
  async createCombination(
    @Body() body: { name: string; code: string; ringRefIds: string[]; rodRefIds: string[]; configSchema?: object },
  ) {
    return this.instruments.createCombination(body);
  }

  @Patch('combinations/:id')
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'DOCTOR')
  async updateCombination(
    @Param('id') id: string,
    @Body() body: {
      name?: string;
      code?: string;
      ringRefIds?: string[];
      rodRefIds?: string[];
      configSchema?: object;
      isActive?: boolean;
    },
  ) {
    return this.instruments.updateCombination(id, body);
  }
}
