import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, Matches } from 'class-validator';

export class CreateSpecialScheduleDto {
  @IsOptional()
  @IsString()
  boothId?: string;

  @IsNotEmpty()
  @IsIn(['recurring', 'one_off'])
  scope: 'recurring' | 'one_off';

  @IsOptional()
  @IsNumber()
  dayOfWeek?: number | null; // 0 a 6

  @IsOptional()
  @IsString()
  specificDate?: string | null; // YYYY-MM-DD

  @IsNotEmpty()
  @IsString()
  description: string;

  @IsNotEmpty()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'Horário da roleta deve estar no formato HH:MM (ex: 12:00)',
  })
  roletaTime: string;
}
