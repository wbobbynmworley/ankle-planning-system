import { IsArray, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class BulkImportDoctorRowDto {
  @IsString()
  name: string;

  @IsString()
  doctorCode: string;

  @IsString()
  phone: string;
}

export class BulkImportDoctorsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkImportDoctorRowDto)
  rows: BulkImportDoctorRowDto[];
}
