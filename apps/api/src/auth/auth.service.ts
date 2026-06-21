import { ConflictException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '@prisma/client';
import { RegisterDoctorDto } from './dto/register-doctor.dto';
import { RegisterPatientDto } from './dto/register-patient.dto';

const SALT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async validateUser(email: string, password: string) {
    try {
      const user = await this.prisma.user.findUnique({ where: { email } });
      if (!user || !(await bcrypt.compare(password, user.passwordHash))) return null;
      return { id: user.id, email: user.email, role: user.role };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('connect') || msg.includes('ECONNREFUSED') || msg.includes('Prisma') || msg.includes('database')) {
        throw new InternalServerErrorException('数据库连接失败，请确认 MySQL 已启动且 apps/api/.env 中 DATABASE_URL 正确');
      }
      throw new InternalServerErrorException('登录服务异常，请稍后重试');
    }
  }

  async login(user: { id: string; email: string; role: string }) {
    return {
      access_token: this.jwt.sign({
        sub: user.id,
        email: user.email,
        role: user.role,
      }),
    };
  }

  async registerDoctor(dto: RegisterDoctorDto) {
    const existing = await this.prisma.user.findFirst({
      where: { OR: [{ email: dto.email }, { doctorCode: dto.doctorCode }] },
    });
    if (existing) {
      throw new ConflictException('邮箱或工号已存在');
    }
    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        name: dto.name,
        role: Role.DOCTOR,
        doctorCode: dto.doctorCode,
        phone: dto.phone ?? null,
      },
      select: { id: true, email: true, name: true, role: true },
    });
    return user;
  }

  /** 患者注册：以身份证号为 key 与数据库对齐，可补齐手机号等；一名患者只能查看自己的规划报告 */
  async registerPatient(dto: RegisterPatientDto) {
    const idNumber = String(dto.patientIdNumber).trim();
    if (!idNumber) throw new ConflictException('请输入身份证号');

    const existingEmail = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existingEmail) throw new ConflictException('该邮箱已被注册');

    const patient = await this.prisma.patient.findUnique({ where: { idNumber } });
    if (patient?.userId) throw new ConflictException('该身份证号已注册过账号，请直接登录');

    const passwordHash = await bcrypt.hash(dto.password, SALT_ROUNDS);
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        passwordHash,
        name: dto.name,
        role: Role.PATIENT,
        phone: dto.phone?.trim() || null,
      },
      select: { id: true, email: true, name: true, role: true },
    });

    await this.prisma.patient.upsert({
      where: { idNumber },
      create: {
        idNumber,
        name: dto.name,
        phone: dto.phone?.trim() || null,
        userId: user.id,
      },
      update: {
        name: dto.name,
        phone: dto.phone?.trim() ?? undefined,
        userId: user.id,
      },
    });
    return user;
  }
}
