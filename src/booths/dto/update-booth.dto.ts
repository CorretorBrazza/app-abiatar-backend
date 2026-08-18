import { IsArray, IsLatitude, IsLongitude, IsOptional, IsPositive, IsString, IsUUID, Length, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateBoothDto {
  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(2, 255)
  address?: string;

  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  @Max(50000)
  gpsRadius?: number;

  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  @Max(1000)
  minimumBrokersRequired?: number;

  @IsOptional()
  @IsUUID()
  managerId?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Length(1, 100, { each: true })
  wifis?: string[];

  @IsOptional()
  @IsString()
  @Length(3, 500)
  reason?: string;
}
