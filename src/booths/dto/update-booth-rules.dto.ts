import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { BoothPeriodDto } from './booth-period.dto';

export const ALL_BROKER_STAGES: ('treinamento' | 'estagiario' | 'corretor_creci')[] = ['treinamento', 'estagiario', 'corretor_creci'];
export type AllowedBrokerStage = (typeof ALL_BROKER_STAGES)[number];

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
  roleta1Time?: string | null;

  @IsString() @IsOptional()
  roleta2Time?: string | null;

  @IsString() @IsOptional()
  roleta3Time?: string | null;

  @IsString() @IsOptional()
  roletaWeekendTime?: string | null;

  @IsInt() @Min(0) @Max(240) @IsOptional()
  checkinEarlyMinutes?: number;

  @IsInt() @Min(0) @Max(240) @IsOptional()
  posBarraMinutes?: number;

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

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BoothPeriodDto)
  @IsOptional()
  periods?: BoothPeriodDto[];

  @IsArray()
  @IsIn(ALL_BROKER_STAGES, { each: true })
  @IsOptional()
  allowedBrokerStages?: AllowedBrokerStage[];

  @IsString() @IsOptional()
  reason?: string;
}
