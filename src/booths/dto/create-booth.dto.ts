// src/booths/dto/create-booth.dto.ts
import { IsArray, IsLatitude, IsLongitude, IsOptional, IsPositive, IsString, IsUUID, Length, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateBoothDto {
  @IsString()
  @Length(2, 100)
  name: string;

  @IsString()
  @Length(2, 255)
  address: string;

  @Type(() => Number)
  @IsLatitude()
  latitude: number;

  @Type(() => Number)
  @IsLongitude()
  longitude: number;

  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  @Max(10000)
  gps_radius?: number;

  @IsOptional()
  @Type(() => Number)
  @IsPositive()
  @Max(1000)
  min_brokers_required?: number;

  @IsOptional()
  @IsUUID()
  managerId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Length(1, 100, { each: true })
  wifis?: string[];
}
