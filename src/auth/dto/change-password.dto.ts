import { IsString, Length, NotEquals } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @Length(8, 128)
  currentPassword: string;

  @IsString()
  @Length(8, 128)
  @NotEquals('12345678', { message: 'Escolha uma senha diferente da senha temporária padrão.' })
  newPassword: string;
}
