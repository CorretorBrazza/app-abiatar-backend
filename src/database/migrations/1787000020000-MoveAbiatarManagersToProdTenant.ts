import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migra os gerentes (gerencia_level_2) do tenant de testes abiatar-teste
 * para o tenant real abiatar (Abiatar Incorporadora e Imobiliária).
 *
 * Movimenta somente usuários ativos e não removidos, que são exatamente os
 * gerentes expostos pelo endpoint público de cadastro. É idempotente: numa
 * segunda execução não há mais gerentes a migrar no tenant de origem.
 *
 * E-mails que já existirem no tenant de destino são preservados (não são
 * movidos) para não violar a unicidade.
 */
export class MoveAbiatarManagersToProdTenant1787000020000 implements MigrationInterface {
  name = 'MoveAbiatarManagersToProdTenant1787000020000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const testTenantRows = await queryRunner.query(
      `SELECT id FROM "tenants" WHERE slug = $1 LIMIT 1`,
      ['abiatar-teste'],
    );
    const prodTenantRows = await queryRunner.query(
      `SELECT id FROM "tenants" WHERE slug = $1 LIMIT 1`,
      ['abiatar'],
    );

    if (!testTenantRows.length) {
      throw new Error('Tenant abiatar-teste não encontrado; migração abortada.');
    }
    if (!prodTenantRows.length) {
      throw new Error('Tenant abiatar não encontrado; migração abortada.');
    }

    const testTenantId = testTenantRows[0].id;
    const prodTenantId = prodTenantRows[0].id;

    const candidates = await queryRunner.query(
      `SELECT id, email
       FROM "users"
       WHERE "tenant_id" = $1
         AND "role" = 'gerencia_level_2'
         AND "status" = 'active'
         AND "removed_at" IS NULL`,
      [testTenantId],
    );

    if (!candidates.length) {
      console.log('[MoveAbiatarManagersToProdTenant] Nenhum gerente ativo em abiatar-teste a migrar.');
      return;
    }

    const candidateEmails = candidates.map((row: { email: string }) => row.email.toLowerCase());

    const conflicts = await queryRunner.query(
      `SELECT lower(email) AS email
       FROM "users"
       WHERE "tenant_id" = $1 AND lower(email) = ANY($2::text[])`,
      [prodTenantId, candidateEmails],
    );
    const conflictEmails = new Set(conflicts.map((row: { email: string }) => row.email));

    const toMove = candidates.filter(
      (row: { email: string }) => !conflictEmails.has(row.email.toLowerCase()),
    );

    if (toMove.length) {
      const ids = toMove.map((row: { id: string }) => row.id);
      await queryRunner.query(
        `UPDATE "users"
         SET "tenant_id" = $1, "updated_at" = now()
         WHERE "id" = ANY($2::uuid[])`,
        [prodTenantId, ids],
      );
    }

    console.log(
      `[MoveAbiatarManagersToProdTenant] migrados=${toMove.length} ` +
        `conflitos=${conflicts.length} (${conflicts.map((c: { email: string }) => c.email).join(', ') || 'nenhum'})`,
    );
  }

  async down(): Promise<void> {
    // O down é deliberadamente no-op: os gerentes migrados já operam no tenant
    // de produção e voltar sem preservar referências poderia criar inconsistências.
  }
}