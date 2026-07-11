// src/auth/dto/register-tenant.dto.ts
export class RegisterTenantDto {
  // Dados do Tenant (Construtora)
  tenantName: string;
  tenantSlug: string; // ex: 'abiatar'
  primaryColor?: string;
  secondaryColor?: string;

  // Dados do Usuário Administrador (Nível 1 - Diretoria)
  userName: string;
  userNomeGuerra: string;
  userEmail: string;
  userPasswordHash: string; // Senha limpa vinda do app (vamos criptografar no serviço)
}