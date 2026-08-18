import { IsOptional, IsString, IsUUID, Length } from 'class-validator';

export class SendOperationalPushDto {
  @IsUUID()
  recipientId: string;

  @IsString()
  @Length(1, 120)
  title: string;

  @IsString()
  @Length(1, 1000)
  body: string;

  @IsOptional()
  @IsUUID()
  boothId?: string;
}
