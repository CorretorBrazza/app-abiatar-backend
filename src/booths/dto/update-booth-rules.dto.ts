import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpdateBoothRulesDto {
  @IsInt() @Min(1) @Max(1440) @IsOptional()
  minimumPeriodMinutes?: number;

  @IsInt() @Min(1) @Max(10) @IsOptional()
  periodWeight?: number;

  @IsInt() @Min(0) @Max(31) @IsOptional()
  saturdayRequiredPeriods?: number;

  @IsInt() @Min(0) @Max(31) @IsOptional()
  sundayRequiredPeriods?: number;

  @IsString() @IsOptional()
  openingTime?: string | null;

  @IsString() @IsOptional()
  closingTime?: string | null;

  @IsInt() @Min(0) @Max(240) @IsOptional()
  checkinToleranceMinutes?: number;

  @IsInt() @Min(0) @Max(240) @IsOptional()
  checkoutToleranceMinutes?: number;

  @IsInt() @Min(1) @Max(240) @IsOptional()
  pingIntervalMinutes?: number;

  @IsInt() @Min(1) @Max(240) @IsOptional()
  pingResponseDeadlineMinutes?: number;

  @IsInt() @Min(0) @Max(1000) @IsOptional()
  minimumBrokersRequired?: number;

  @IsInt() @Min(1) @Max(50000) @IsOptional()
  gpsRadiusMeters?: number;

  @IsBoolean() @IsOptional()
  weekendEnabled?: boolean;

  @IsInt() @Min(0) @Max(1000) @IsOptional()
  minimumMonthlyPeriods?: number;

  @IsString() @IsOptional()
  reason?: string;
}
