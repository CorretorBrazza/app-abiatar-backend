import { IsString, Length } from 'class-validator';

export class NotifyBrokerCorrectionDto {
  @IsString()
  @Length(3, 600)
  message: string;
}