import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBrokerManagementState1787000006000 implements MigrationInterface {
  name = 'AddBrokerManagementState1787000006000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "leads_paused" boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "leads_pause_reason" character varying(240),
      ADD COLUMN IF NOT EXISTS "removed_at" TIMESTAMP,
      ADD COLUMN IF NOT EXISTS "removed_by" uuid
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_users_tenant_role_removed"
      ON "users" ("tenant_id", "role", "removed_at")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_users_tenant_role_removed"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "removed_by", DROP COLUMN IF EXISTS "removed_at", DROP COLUMN IF EXISTS "leads_pause_reason", DROP COLUMN IF EXISTS "leads_paused"`);
  }
}
