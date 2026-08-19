// src/users/dto/approve-broker.dto.ts
import { IsIn, IsInt } from 'class-validator';
import { Type } from 'class-transformer';

export class ApproveBrokerDto {
  @Type(() => Number)
  @IsInt()
  @IsIn([0, 7, 15, 30])
  carenciaDays: number;
}
