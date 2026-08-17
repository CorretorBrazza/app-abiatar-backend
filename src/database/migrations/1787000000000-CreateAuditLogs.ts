import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuditLogs1787000000000 implements MigrationInterface {
  name = 'CreateAuditLogs1787000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "audit_logs" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "tenant_id" uuid,
        "booth_id" uuid,
        "actor_user_id" uuid,
        "actor_role" varchar(80),
        "actor_email_snapshot" varchar(160),
        "session_id" varchar(120),
        "request_id" varchar(120),
        "action" varchar(120) NOT NULL,
        "entity_type" varchar(80),
        "entity_id" varchar(120),
        "before_data" jsonb,
        "after_data" jsonb,
        "reason" text,
        "ip_address" inet,
        "user_agent" text,
        "success" boolean NOT NULL DEFAULT true,
        "error_code" varchar(120),
        "metadata" jsonb,
        CONSTRAINT "PK_audit_logs_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_audit_logs_tenant_created" ON "audit_logs" ("tenant_id", "created_at" DESC)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_audit_logs_booth_created" ON "audit_logs" ("booth_id", "created_at" DESC)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_audit_logs_actor_created" ON "audit_logs" ("actor_user_id", "created_at" DESC)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_audit_logs_action_created" ON "audit_logs" ("action", "created_at" DESC)`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_audit_logs_entity" ON "audit_logs" ("entity_type", "entity_id")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_audit_logs_entity"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_audit_logs_action_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_audit_logs_actor_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_audit_logs_booth_created"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_audit_logs_tenant_created"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_logs"`);
  }
}
