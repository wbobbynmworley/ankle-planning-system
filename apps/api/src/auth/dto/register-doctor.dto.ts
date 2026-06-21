import { IsEmail, IsString, MinLength, IsOptional } from 'class-validator';

export class RegisterDoctorDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8, { message: '密码至少8位' })
  password: string;

  @IsString()
  name: string;

  @IsString()
  doctorCode: string;

  @IsOptional()
  @IsString()
  phone?: string;
}
