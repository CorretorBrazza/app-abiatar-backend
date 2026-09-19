import { MigrationInterface, QueryRunner } from 'typeorm';

export class QrCodeCheckIn1787000022000 implements MigrationInterface {
  name = 'QrCodeCheckIn1787000022000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "presences"
      ADD COLUMN IF NOT EXISTS "check_in_method" character varying(20);
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "qr_codes" (
        "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "booth_id" uuid NOT NULL,
        "token" character varying(500) NOT NULL,
        "code" character varying(16) NOT NULL,
        "valid_for_date" character varying(10) NOT NULL,
        "expires_at" timestamp NOT NULL,
        "generated_by" uuid NOT NULL,
        "created_at" timestamp NOT NULL DEFAULT now(),
        "updated_at" timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "uq_qr_codes_code" UNIQUE ("code")
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_qr_codes_tenant_booth_date"
      ON "qr_codes" ("tenant_id", "booth_id", "valid_for_date");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "qr_codes";`);
    await queryRunner.query(`ALTER TABLE "presences" DROP COLUMN IF EXISTS "check_in_method";`);
  }
}

export default QrCodeCheckIn1787000022000;