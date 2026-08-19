import { MigrationInterface, QueryRunner } from 'typeorm';
import * as bcrypt from 'bcryptjs';

/**
 * Limpeza única do ambiente interno de testes.
 *
 * A operação é deliberadamente limitada pelo slug do tenant e por uma lista
 * explícita de e-mails autorizados. Não deve ser reutilizada para tenants reais.
 */
export class CleanupAbiatarTestUsers1787000007000 implements MigrationInterface {
  name = 'CleanupAbiatarTestUsers1787000007000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const tenantRows = await queryRunner.query(
      `SELECT id FROM "tenants" WHERE slug = $1 LIMIT 1`,
      ['abiatar-teste'],
    );

    if (!tenantRows.length) {
      throw new Error('Tenant de testes abiatar-teste não encontrado; limpeza abortada.');
    }

    const tenantId = tenantRows[0].id;
    const allowedEmails = [
      'diretor@abiatar.test',
      'gerente@abiatar.test',
      'corretor@abiatar.test',
      'recepcao@abiatar.test',
    ];

    const existingRows = await queryRunner.query(
      `SELECT lower(email) AS email FROM "users" WHERE "tenant_id" = $1 AND lower(email) = ANY($2::text[])`,
      [tenantId, allowedEmails],
    );
    const existingEmails = new Set(existingRows.map((row: { email: string }) => row.email));
    const missing = allowedEmails.filter((email) => !existingEmails.has(email));
    if (missing.length) {
      throw new Error(`Limpeza abortada; usuários autorizados ausentes: ${missing.join(', ')}`);
    }

    // O hash é gerado dentro da migration; a senha nunca é armazenada em claro.
    const passwordHash = await bcrypt.hash('12345678', 10);

    await queryRunner.query(
      `UPDATE "users"
       SET "password_hash" = $1,
           "status" = CASE
             WHEN lower("email") = 'diretor@abiatar.test' THEN 'active'
             WHEN lower("email") = 'gerente@abiatar.test' THEN 'active'
             WHEN lower("email") = 'recepcao@abiatar.test' THEN 'active'
             ELSE "status"
           END,
           "removed_at" = NULL,
           "removed_by" = NULL,
           "leads_paused" = false,
           "leads_pause_reason" = NULL,
           "updated_at" = now()
       WHERE "tenant_id" = $2 AND lower("email") = ANY($3::text[])`,
      [passwordHash, tenantId, allowedEmails],
    );

    // Exclusão física intencional somente dos demais usuários deste tenant de testes.
    // As FKs existentes possuem CASCADE/SET NULL conforme o modelo operacional.
    await queryRunner.query(
      `DELETE FROM "users"
       WHERE "tenant_id" = $1
         AND lower("email") <> ALL($2::text[])`,
      [tenantId, allowedEmails],
    );
  }

  async down(): Promise<void> {
    // Não é possível restaurar usuários excluídos sem um backup externo.
    // O down é deliberadamente no-op para impedir uma falsa promessa de restauração.
  }
}
