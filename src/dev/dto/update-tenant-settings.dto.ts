import { IsBoolean, IsOptional, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class TenantFeaturesSettingsDto {
  @IsOptional()
  @IsBoolean({ message: 'nova_identidade deve ser um booleano.' })
  nova_identidade?: boolean;
}

export class UpdateTenantSettingsDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => TenantFeaturesSettingsDto)
  features?: TenantFeaturesSettingsDto;
}