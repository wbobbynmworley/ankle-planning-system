import { ConflictException, Injectable } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';

const SALT_ROUNDS = 12;

function generatePassword(length = 10): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < length; i++) {
    s += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return s;
}

export interface BulkImportDoctorRow {
  name: string;
  doctorCode: string;
  phone: string;
}

export interface BulkImportResult {
  created: number;
  skipped: number;
  errors: string[];
  generatedPasswords: { email: string; password: string }[];
}

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async bulkImportDoctors(rows: BulkImportDoctorRow[]): Promise<BulkImportResult> {
    const result: BulkImportResult = {
      created: 0,
      skipped: 0,
      errors: [],
      generatedPasswords: [],
    };

    for (const row of rows) {
      const email = `${row.doctorCode}@doctor.local`;
      const existing = await this.prisma.user.findFirst({
        where: { OR: [{ email }, { doctorCode: row.doctorCode }] },
      });
      if (existing) {
        result.skipped += 1;
        continue;
      }
      const password = generatePassword();
      const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
      try {
        await this.prisma.user.create({
          data: {
            email,
            passwordHash,
            name: row.name,
            role: Role.DOCTOR,
            doctorCode: row.doctorCode,
            phone: row.phone || null,
          },
        });
        result.created += 1;
        result.generatedPasswords.push({ email, password });
      } catch (e) {
        result.errors.push(`${row.doctorCode}: ${(e as Error).message}`);
      }
    }
    return result;
  }

  async findAll(role?: Role) {
    const where = role ? { role } : {};
    return this.prisma.user.findMany({
      where,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        doctorCode: true,
        phone: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
