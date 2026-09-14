import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAttendanceRecordsAndVezRotation1787000018000 implements MigrationInterface {
  name = 'AddAttendanceRecordsAndVezRotation1787000018000';

  // Tabela de registro de TODOS os atendimentos (vez/simples) da Recepção + colunas
  // de rotação ("Atendimento vez") na presença. Necessária para o fluxo da nova identidade;
  // sem ela o schema de produção (synchronize desligado) fica sem a tabela/colunas.
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "attendance_records" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "presence_id" uuid,
        "broker_id" uuid NOT NULL,
        "booth_id" uuid NOT NULL,
        "tipo" varchar(20) NOT NULL,
        "in_sequence" boolean NOT NULL DEFAULT false,
        "attended_at" TIMESTAMP NOT NULL,
        "attended_by_user_id" uuid NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_attendance_records_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_attendance_records_tenant_broker" ON "attendance_records" ("tenant_id", "broker_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_attendance_records_tenant_booth" ON "attendance_records" ("tenant_id", "booth_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_attendance_records_tenant_attended_at" ON "attendance_records" ("tenant_id", "attended_at")`);

    await queryRunner.query(`ALTER TABLE "attendance_records" ADD CONSTRAINT "FK_attendance_records_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "attendance_records" ADD CONSTRAINT "FK_attendance_records_broker" FOREIGN KEY ("broker_id") REFERENCES "users"("id") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "attendance_records" ADD CONSTRAINT "FK_attendance_records_booth" FOREIGN KEY ("booth_id") REFERENCES "booths"("id") ON DELETE CASCADE`);

    await queryRunner.query(`ALTER TABLE "presences" ADD COLUMN IF NOT EXISTS "vez_rotations" integer NOT NULL DEFAULT 0`);
    await queryRunner.query(`ALTER TABLE "presences" ADD COLUMN IF NOT EXISTS "last_vez_at" TIMESTAMP NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "presences" DROP COLUMN IF EXISTS "last_vez_at"`);
    await queryRunner.query(`ALTER TABLE "presences" DROP COLUMN IF EXISTS "vez_rotations"`);
    await queryRunner.query(`ALTER TABLE "attendance_records" DROP CONSTRAINT IF EXISTS "FK_attendance_records_booth"`);
    await queryRunner.query(`ALTER TABLE "attendance_records" DROP CONSTRAINT IF EXISTS "FK_attendance_records_broker"`);
    await queryRunner.query(`ALTER TABLE "attendance_records" DROP CONSTRAINT IF EXISTS "FK_attendance_records_tenant"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_attendance_records_tenant_attended_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_attendance_records_tenant_booth"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_attendance_records_tenant_broker"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "attendance_records"`);
  }
}

export default AddAttendanceRecordsAndVezRotation1787000018000;