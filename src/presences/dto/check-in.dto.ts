// src/presences/dto/check-in.dto.ts
import { IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Type } from 'class-transformer';

export class CheckInDto {
  @IsUUID()
  boothId: string;

  @Type(() => Number)
  @IsLatitude()
  latitude: number;

  @Type(() => Number)
  @IsLongitude()
  longitude: number;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  ssid?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  capturedAt?: number;
}
