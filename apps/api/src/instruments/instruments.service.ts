import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InstrumentRing, InstrumentRod, InstrumentCombination } from '@prisma/client';

@Injectable()
export class InstrumentsService {
  constructor(private prisma: PrismaService) {}

  async findAllRings(activeOnly = true): Promise<InstrumentRing[]> {
    return this.prisma.instrumentRing.findMany({
      where: activeOnly ? { isActive: true } : undefined,
      orderBy: { code: 'asc' },
    });
  }

  async findRingById(id: string): Promise<InstrumentRing> {
    const ring = await this.prisma.instrumentRing.findUnique({ where: { id } });
    if (!ring) throw new NotFoundException('Instrument ring not found');
    return ring;
  }

  async createRing(data: { name: string; code: string; diameterMm?: number; spec?: object }): Promise<InstrumentRing> {
    return this.prisma.instrumentRing.create({
      data: {
        name: data.name,
        code: data.code,
        diameterMm: data.diameterMm ?? undefined,
        spec: data.spec ?? undefined,
      },
    });
  }

  async updateRing(
    id: string,
    data: { name?: string; code?: string; diameterMm?: number; spec?: object; isActive?: boolean },
  ): Promise<InstrumentRing> {
    await this.findRingById(id);
    return this.prisma.instrumentRing.update({
      where: { id },
      data: {
        ...(data.name != null && { name: data.name }),
        ...(data.code != null && { code: data.code }),
        ...(data.diameterMm != null && { diameterMm: data.diameterMm }),
        ...(data.spec != null && { spec: data.spec as any }),
        ...(data.isActive != null && { isActive: data.isActive }),
      },
    });
  }

  async findAllRods(activeOnly = true): Promise<InstrumentRod[]> {
    return this.prisma.instrumentRod.findMany({
      where: activeOnly ? { isActive: true } : undefined,
      orderBy: { code: 'asc' },
    });
  }

  async findRodById(id: string): Promise<InstrumentRod> {
    const rod = await this.prisma.instrumentRod.findUnique({ where: { id } });
    if (!rod) throw new NotFoundException('Instrument rod not found');
    return rod;
  }

  async createRod(data: { name: string; code: string; lengthMm?: number; spec?: object }): Promise<InstrumentRod> {
    return this.prisma.instrumentRod.create({
      data: {
        name: data.name,
        code: data.code,
        lengthMm: data.lengthMm ?? undefined,
        spec: data.spec ?? undefined,
      },
    });
  }

  async updateRod(
    id: string,
    data: { name?: string; code?: string; lengthMm?: number; spec?: object; isActive?: boolean },
  ): Promise<InstrumentRod> {
    await this.findRodById(id);
    return this.prisma.instrumentRod.update({
      where: { id },
      data: {
        ...(data.name != null && { name: data.name }),
        ...(data.code != null && { code: data.code }),
        ...(data.lengthMm != null && { lengthMm: data.lengthMm }),
        ...(data.spec != null && { spec: data.spec as any }),
        ...(data.isActive != null && { isActive: data.isActive }),
      },
    });
  }

  async findAllCombinations(activeOnly = true): Promise<InstrumentCombination[]> {
    return this.prisma.instrumentCombination.findMany({
      where: activeOnly ? { isActive: true } : undefined,
      orderBy: { code: 'asc' },
    });
  }

  async findCombinationById(id: string): Promise<InstrumentCombination> {
    const combo = await this.prisma.instrumentCombination.findUnique({ where: { id } });
    if (!combo) throw new NotFoundException('Instrument combination not found');
    return combo;
  }

  async createCombination(data: {
    name: string;
    code: string;
    ringRefIds: string[];
    rodRefIds: string[];
    configSchema?: object;
  }): Promise<InstrumentCombination> {
    return this.prisma.instrumentCombination.create({
      data: {
        name: data.name,
        code: data.code,
        ringRefIds: data.ringRefIds as any,
        rodRefIds: data.rodRefIds as any,
        configSchema: data.configSchema as any,
      },
    });
  }

  async updateCombination(
    id: string,
    data: {
      name?: string;
      code?: string;
      ringRefIds?: string[];
      rodRefIds?: string[];
      configSchema?: object;
      isActive?: boolean;
    },
  ): Promise<InstrumentCombination> {
    await this.findCombinationById(id);
    return this.prisma.instrumentCombination.update({
      where: { id },
      data: {
        ...(data.name != null && { name: data.name }),
        ...(data.code != null && { code: data.code }),
        ...(data.ringRefIds != null && { ringRefIds: data.ringRefIds as any }),
        ...(data.rodRefIds != null && { rodRefIds: data.rodRefIds as any }),
        ...(data.configSchema != null && { configSchema: data.configSchema as any }),
        ...(data.isActive != null && { isActive: data.isActive }),
      },
    });
  }
}
