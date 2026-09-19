// src/presences/dto/check-in.dto.ts
import { IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, IsUUID, Length } from 'class-validator';
import { Type } from 'class-transformer';

export class CheckInDto {
  @IsOptional()
  @IsUUID()
  boothId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  @IsLongitude()
  longitude?: number;

  @IsOptional()
  @IsString()
  @Length(1, 100)
  ssid?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  capturedAt?: number;

  // Check-in via QR da Recepção: token assinado ou código curto. Quando presente,
  // o plantão é derivado do próprio token e a validação de proximidade é dispensada.
  @IsOptional()
  @IsString()
  @Length(1, 500)
  qrToken?: string;

  @IsOptional()
  @IsString()
  @Length(1, 16)
  code?: string;
}