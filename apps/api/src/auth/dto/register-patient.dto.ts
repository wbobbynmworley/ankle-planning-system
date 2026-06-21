import { IsEmail, IsString, MinLength, IsOptional } from 'class-validator';

export class RegisterPatientDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8, { message: '密码至少8位' })
  password: string;

  @IsString()
  name: string;

  @IsString()
  patientIdNumber: string;

  @IsOptional()
  @IsString()
  phone?: string;
}
