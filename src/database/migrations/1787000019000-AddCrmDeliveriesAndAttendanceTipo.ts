import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCrmDeliveriesAndAttendanceTipo1787000019000 implements MigrationInterface {
  name = 'AddCrmDeliveriesAndAttendanceTipo1787000019000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "attendance_records"
      SET "tipo" = 'agendamento'
      WHERE "tipo" = 'simples';
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "crm_deliveries" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "attendance_id" uuid NULL,
        "tipo" varchar(20) NOT NULL,
        "status" varchar(20) NOT NULL,
        "error_message" text NULL,
        "cliente_informado" boolean NOT NULL DEFAULT false,
        "delivered_at" timestamp NULL,
        "created_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "PK_crm_deliveries_id" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_crm_deliveries_tenant_created" ON "crm_deliveries" ("tenant_id", "created_at");`);
    await queryRunner.query(`ALTER TABLE "crm_deliveries" ADD CONSTRAINT "FK_crm_deliveries_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE;`);
    await queryRunner.query(`ALTER TABLE "crm_deliveries" ADD CONSTRAINT "FK_crm_deliveries_attendance" FOREIGN KEY ("attendance_id") REFERENCES "attendance_records"("id") ON DELETE SET NULL;`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "crm_deliveries" DROP CONSTRAINT IF EXISTS "FK_crm_deliveries_attendance";`);
    await queryRunner.query(`ALTER TABLE "crm_deliveries" DROP CONSTRAINT IF EXISTS "FK_crm_deliveries_tenant";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_crm_deliveries_tenant_created";`);
    await queryRunner.query(`DROP TABLE IF EXISTS "crm_deliveries";`);
    await queryRunner.query(`UPDATE "attendance_records" SET "tipo" = 'simples' WHERE "tipo" = 'agendamento';`);
  }
}