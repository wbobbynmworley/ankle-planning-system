import { Controller, Post, Body, UseGuards, UnauthorizedException, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { LoginDto } from './dto/login.dto';
import { RegisterDoctorDto } from './dto/register-doctor.dto';
import { RegisterPatientDto } from './dto/register-patient.dto';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('login')
  async login(@Body() body: LoginDto) {
    const user = await this.auth.validateUser(body.email, body.password);
    if (!user) throw new UnauthorizedException('邮箱或密码错误');
    return this.auth.login(user);
  }

  @Post('register/doctor')
  async registerDoctor(@Body() body: RegisterDoctorDto) {
    return this.auth.registerDoctor(body);
  }

  @Post('register/patient')
  async registerPatient(@Body() body: RegisterPatientDto) {
    return this.auth.registerPatient(body);
  }

  @UseGuards(JwtAuthGuard)
  @Post('me')
  async me(@Req() req: Request) {
    const user = (req as any).user;
    return { ok: true, user: user ? { id: user.id, email: user.email, role: user.role } : null };
  }
}
