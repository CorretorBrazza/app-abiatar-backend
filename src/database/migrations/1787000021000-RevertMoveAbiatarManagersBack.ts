import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Reversão de emergência (go-live): restaura os gerentes (gerencia_level_2)
 * que foram movidos do tenant abiatar-teste para o tenant abiatar de volta ao
 * tenant abiatar-teste.
 *
 * Os corretores reais permanecem em abiatar-teste com manager_id apontando
 * para esses gerentes; movê-los de volta restaura o vínculo gerente-corretor
 * exibido no sistema. Idempotente: após a execução não há gerentes a devolver.
 *
 * Protegido contra conflito: e-mail já presente no destino não é movido.
 */
export class RevertMoveAbiatarManagersBack1787000021000 implements MigrationInterface {
  name = 'RevertMoveAbiatarManagersBack1787000021000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const prodTenantRows = await queryRunner.query(
      `SELECT id FROM "tenants" WHERE slug = $1 LIMIT 1`,
      ['abiatar'],
    );
    const testTenantRows = await queryRunner.query(
      `SELECT id FROM "tenants" WHERE slug = $1 LIMIT 1`,
      ['abiatar-teste'],
    );

    if (!prodTenantRows.length) {
      throw new Error('Tenant abiatar não encontrado; reversão abortada.');
    }
    if (!testTenantRows.length) {
      throw new Error('Tenant abiatar-teste não encontrado; reversão abortada.');
    }

    const prodTenantId = prodTenantRows[0].id;
    const testTenantId = testTenantRows[0].id;

    const candidates = await queryRunner.query(
      `SELECT id, email
       FROM "users"
       WHERE "tenant_id" = $1
         AND "role" = 'gerencia_level_2'
         AND "status" = 'active'
         AND "removed_at" IS NULL`,
      [prodTenantId],
    );

    if (!candidates.length) {
      console.log('[RevertMoveAbiatarManagersBack] Nenhum gerente em abiatar a devolver.');
      return;
    }

    const candidateEmails = candidates.map((row: { email: string }) => row.email.toLowerCase());

    const conflicts = await queryRunner.query(
      `SELECT lower(email) AS email
       FROM "users"
       WHERE "tenant_id" = $1 AND lower(email) = ANY($2::text[])`,
      [testTenantId, candidateEmails],
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
        [testTenantId, ids],
      );
    }

    console.log(
      `[RevertMoveAbiatarManagersBack] devolvidos=${toMove.length} ` +
        `conflitos=${conflicts.length} (${conflicts.map((c: { email: string }) => c.email).join(', ') || 'nenhum'})`,
    );
  }

  async down(): Promise<void> {
    // no-op: preservar o estado restaurado em produção.
  }
}