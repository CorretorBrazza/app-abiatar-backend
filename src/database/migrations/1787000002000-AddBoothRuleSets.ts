import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBoothRuleSets1787000002000 implements MigrationInterface {
  name = 'AddBoothRuleSets1787000002000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "presences" ADD COLUMN IF NOT EXISTS "rule_set_id" uuid
    `);
    await queryRunner.query(`ALTER TABLE "presences" ADD COLUMN IF NOT EXISTS "minimum_period_minutes" integer NOT NULL DEFAULT 120`);
    await queryRunner.query(`ALTER TABLE "presences" ADD COLUMN IF NOT EXISTS "period_weight" integer NOT NULL DEFAULT 1`);
    await queryRunner.query(`ALTER TABLE "presences" ADD COLUMN IF NOT EXISTS "minimum_monthly_periods" integer NOT NULL DEFAULT 20`);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "booth_rule_sets" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "booth_id" uuid NOT NULL,
        "version" integer NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "minimum_period_minutes" integer NOT NULL DEFAULT 120,
        "period_weight" integer NOT NULL DEFAULT 1,
        "saturday_required_periods" integer NOT NULL DEFAULT 5,
        "sunday_required_periods" integer NOT NULL DEFAULT 6,
        "opening_time" time,
        "closing_time" time,
        "checkin_tolerance_minutes" integer NOT NULL DEFAULT 0,
        "checkout_tolerance_minutes" integer NOT NULL DEFAULT 0,
        "ping_interval_minutes" integer NOT NULL DEFAULT 30,
        "ping_response_deadline_minutes" integer NOT NULL DEFAULT 5,
        "minimum_brokers_required" integer NOT NULL DEFAULT 2,
        "gps_radius_meters" integer NOT NULL DEFAULT 100,
        "weekend_enabled" boolean NOT NULL DEFAULT true,
        "minimum_monthly_periods" integer NOT NULL DEFAULT 20,
        "created_by" uuid,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_booth_rule_sets_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_booth_rule_sets_booth_version" UNIQUE ("booth_id", "version"),
        CONSTRAINT "FK_booth_rule_sets_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_booth_rule_sets_booth" FOREIGN KEY ("booth_id") REFERENCES "booths"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_booth_rule_sets_creator" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_booth_rule_sets_tenant_booth_active" ON "booth_rule_sets" ("tenant_id", "booth_id", "is_active")`);
    await queryRunner.query(`
      INSERT INTO "booth_rule_sets" ("tenant_id", "booth_id", "version", "minimum_brokers_required", "gps_radius_meters")
      SELECT b."tenant_id", b."id", 1, b."min_brokers_required", b."gps_radius"
      FROM "booths" b
      WHERE NOT EXISTS (
        SELECT 1 FROM "booth_rule_sets" r WHERE r."booth_id" = b."id"
      )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "presences" DROP COLUMN IF EXISTS "rule_set_id"`);
    await queryRunner.query(`ALTER TABLE "presences" DROP COLUMN IF EXISTS "minimum_period_minutes"`);
    await queryRunner.query(`ALTER TABLE "presences" DROP COLUMN IF EXISTS "period_weight"`);
    await queryRunner.query(`ALTER TABLE "presences" DROP COLUMN IF EXISTS "minimum_monthly_periods"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_booth_rule_sets_tenant_booth_active"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "booth_rule_sets"`);
  }
}
