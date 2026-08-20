import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWeeklyPeriodReports1787000013000 implements MigrationInterface {
  name = 'AddWeeklyPeriodReports1787000013000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "weekly_period_reports" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "tenant_id" uuid NOT NULL,
      "week_start" date NOT NULL,
      "week_end" date NOT NULL,
      "status" character varying NOT NULL DEFAULT 'in_progress',
      "rules_snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "totals" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "closed_at" TIMESTAMP,
      "closed_by" uuid,
      "created_at" TIMESTAMP NOT NULL DEFAULT now(),
      "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
      CONSTRAINT "PK_weekly_period_reports" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_weekly_period_reports_tenant_week" UNIQUE ("tenant_id", "week_start")
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_weekly_period_reports_tenant" ON "weekly_period_reports" ("tenant_id", "week_start")`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "weekly_period_report_items" (
      "id" uuid NOT NULL DEFAULT gen_random_uuid(),
      "report_id" uuid NOT NULL,
      "tenant_id" uuid NOT NULL,
      "broker_id" uuid NOT NULL,
      "manager_id" uuid,
      "booth_id" uuid NOT NULL,
      "broker_name_snapshot" character varying NOT NULL,
      "broker_nome_guerra_snapshot" character varying,
      "valid_periods" integer NOT NULL DEFAULT 0,
      "invalidated_periods" integer NOT NULL DEFAULT 0,
      "accumulated_minutes" integer NOT NULL DEFAULT 0,
      "weighted_periods" integer NOT NULL DEFAULT 0,
      "presence_count" integer NOT NULL DEFAULT 0,
      "absence_count" integer NOT NULL DEFAULT 0,
      "weekend_eligible" boolean NOT NULL DEFAULT false,
      "details" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "created_at" TIMESTAMP NOT NULL DEFAULT now(),
      "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
      CONSTRAINT "PK_weekly_period_report_items" PRIMARY KEY ("id"),
      CONSTRAINT "UQ_weekly_period_report_items_scope" UNIQUE ("report_id", "broker_id", "booth_id"),
      CONSTRAINT "FK_weekly_period_report_items_report" FOREIGN KEY ("report_id") REFERENCES "weekly_period_reports"("id") ON DELETE CASCADE
    )`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_weekly_period_report_items_tenant" ON "weekly_period_report_items" ("tenant_id", "broker_id", "booth_id")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "weekly_period_report_items"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "weekly_period_reports"`);
  }
}
