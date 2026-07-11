// src/users/dto/register-broker.dto.ts
export class RegisterBrokerDto {
  token: string; // O token único do link que ele abriu no celular
  name: string;
  nomeGuerra: string;
  email: string;
  passwordHash: string;
  creci: string;
}