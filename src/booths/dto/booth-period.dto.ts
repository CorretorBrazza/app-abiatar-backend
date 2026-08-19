import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class BoothPeriodDto {
  @IsString()
  id: string;

  @IsString()
  name: string;

  @IsString()
  openingTime: string;

  @IsString()
  closingTime: string;

  @IsInt()
  @Min(0)
  @Max(1440)
  minimumMinutes: number;

  @IsInt()
  @Min(0)
  @Max(240)
  checkinToleranceMinutes: number;

  @IsInt()
  @Min(0)
  @Max(240)
  checkoutToleranceMinutes: number;

  @IsBoolean()
  @IsOptional()
  enabled?: boolean;
}
