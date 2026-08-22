// src/users/dto/approve-broker.dto.ts
import { IsIn, IsInt, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class ApproveBrokerDto {
  @Type(() => Number)
  @IsInt()
  @IsIn([0, 7, 15, 30])
  carenciaDays: number;

  @IsOptional()
  @IsIn(['treinamento', 'estagiario', 'corretor_creci'])
  brokerStage?: 'treinamento' | 'estagiario' | 'corretor_creci';
}

