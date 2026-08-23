import { IsArray, IsEnum, IsNotEmpty, IsOptional, IsString, Length, Matches } from 'class-validator';

export class CreateBoothHolidayDto {
  @IsString()
  @IsNotEmpty({ message: 'A data do feriado é obrigatória.' })
  @Matches(/^(\d{4}-\d{2}-\d{2}|\d{2}\/\d{2}\/\d{4})$/, {
    message: 'A data deve estar no formato AAAA-MM-DD ou DD/MM/AAAA.',
  })
  date: string;

  @IsString()
  @IsNotEmpty({ message: 'O nome do feriado é obrigatório.' })
  @Length(2, 150, { message: 'O nome do feriado deve conter entre 2 e 150 caracteres.' })
  name: string;

  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, { message: 'O horário da roleta deve estar no formato HH:MM.' })
  roletaTime?: string;

  @IsEnum(['all', 'specific'], { message: 'O escopo deve ser "all" (todos os plantões) ou "specific" (plantões específicos).' })
  scope: 'all' | 'specific';

  @IsOptional()
  @IsArray({ message: 'boothIds deve ser uma lista de IDs de plantões.' })
  @IsString({ each: true })
  boothIds?: string[];
}
