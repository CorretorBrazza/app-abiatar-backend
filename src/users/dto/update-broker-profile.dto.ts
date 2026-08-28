import { IsEmail, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

export class UpdateBrokerProfileDto {
  @IsOptional()
  @IsString()
  @Length(2, 150)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(2, 50)
  @Matches(/^[^\r\n]+$/, { message: 'O nome de guerra não pode conter quebras de linha.' })
  nomeGuerra?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @Length(1, 30)
  creci?: string;

  @IsOptional()
  @IsIn(['treinamento', 'estagiario', 'corretor_creci'])
  brokerStage?: 'treinamento' | 'estagiario' | 'corretor_creci';
}

export class UpdateBrokerStageDto {
  @IsOptional()
  @IsIn(['treinamento', 'estagiario', 'corretor_creci'])
  brokerStage?: 'treinamento' | 'estagiario' | 'corretor_creci';

  @IsOptional()
  @IsString()
  @Length(1, 30)
  creci?: string;

  @IsOptional()
  extendDays?: number;

  @IsOptional()
  @IsString()
  newExpiresAt?: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class UpdateBrokerLeadPauseDto {
  @IsString()
  @Length(3, 240)
  reason: string;
}

export class TransferBrokerDto {
  @IsString()
  managerId: string;

  @IsOptional()
  @IsString()
  @Length(3, 240)
  reason?: string;
}

