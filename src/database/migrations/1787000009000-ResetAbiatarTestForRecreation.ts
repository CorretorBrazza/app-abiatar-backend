import { MigrationInterface, QueryRunner } from 'typeorm';
import * as bcrypt from 'bcryptjs';

/** Limpeza única do tenant de testes antes da recriação dos perfis hierárquicos. */
export class ResetAbiatarTestForRecreation1787000009000 implements MigrationInterface {
  name = 'ResetAbiatarTestForRecreation1787000009000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const tenants = await queryRunner.query(`SELECT id FROM "tenants" WHERE slug = $1 LIMIT 1`, ['abiatar-teste']);
    if (!tenants.length) throw new Error('Tenant abiatar-teste não encontrado; limpeza abortada.');
    const tenantId = tenants[0].id;
    const directorEmail = 'diretor@abiatar.test';
    const director = await queryRunner.query(
      `SELECT id FROM "users" WHERE "tenant_id" = $1 AND lower(email) = $2 LIMIT 1`,
      [tenantId, directorEmail],
    );
    if (!director.length) throw new Error('Diretor de teste não encontrado; limpeza abortada.');

    await queryRunner.query(
      `DELETE FROM "users" WHERE "tenant_id" = $1 AND lower(email) <> $2`,
      [tenantId, directorEmail],
    );

    const passwordHash = await bcrypt.hash('12345678', 10);
    await queryRunner.query(
      `UPDATE "users"
       SET "password_hash" = $1, "status" = 'active', "must_change_password" = false,
           "password_reset_expires_at" = NULL, "session_version" = COALESCE("session_version", 0) + 1,
           "updated_at" = now()
       WHERE "tenant_id" = $2 AND lower(email) = $3`,
      [passwordHash, tenantId, directorEmail],
    );
  }

  async down(): Promise<void> {
    // Usuários excluídos só podem ser restaurados por backup; não há rollback fictício.
  }
}
