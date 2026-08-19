import { IsEmail, IsOptional, IsString, Length, Matches } from 'class-validator';

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
  @Length(3, 20)
  creci?: string;
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
