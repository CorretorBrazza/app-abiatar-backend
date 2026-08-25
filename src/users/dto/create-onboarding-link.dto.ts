import { IsIn, IsNumber, IsOptional, IsUUID } from 'class-validator';

export class CreateOnboardingLinkDto {
  @IsIn(['gerencia_level_2', 'corretor_level_3'])
  invitedRole: 'gerencia_level_2' | 'corretor_level_3';

  @IsOptional()
  @IsUUID()
  managerId?: string;

  @IsOptional()
  @IsNumber()
  expiresInDays?: number;
}
