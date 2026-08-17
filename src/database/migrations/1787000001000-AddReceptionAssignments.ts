import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReceptionAssignments1787000001000 implements MigrationInterface {
  name = 'AddReceptionAssignments1787000001000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TYPE "users_role_enum"
      ADD VALUE IF NOT EXISTS 'platform_admin_level_0'
    `);
    await queryRunner.query(`
      ALTER TYPE "users_role_enum"
      ADD VALUE IF NOT EXISTS 'recepcao_level_3'
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "booth_receptionists" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "booth_id" uuid NOT NULL,
        "receptionist_id" uuid NOT NULL,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_booth_receptionists_id" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_booth_receptionists_booth_user" UNIQUE ("booth_id", "receptionist_id")
      )
    `);

    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_booth_receptionists_tenant_booth" ON "booth_receptionists" ("tenant_id", "booth_id")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_booth_receptionists_tenant_user" ON "booth_receptionists" ("tenant_id", "receptionist_id")`);
    await queryRunner.query(`ALTER TABLE "booth_receptionists" ADD CONSTRAINT "FK_booth_receptionists_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "booth_receptionists" ADD CONSTRAINT "FK_booth_receptionists_booth" FOREIGN KEY ("booth_id") REFERENCES "booths"("id") ON DELETE CASCADE`);
    await queryRunner.query(`ALTER TABLE "booth_receptionists" ADD CONSTRAINT "FK_booth_receptionists_user" FOREIGN KEY ("receptionist_id") REFERENCES "users"("id") ON DELETE CASCADE`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "booth_receptionists" DROP CONSTRAINT IF EXISTS "FK_booth_receptionists_user"`);
    await queryRunner.query(`ALTER TABLE "booth_receptionists" DROP CONSTRAINT IF EXISTS "FK_booth_receptionists_booth"`);
    await queryRunner.query(`ALTER TABLE "booth_receptionists" DROP CONSTRAINT IF EXISTS "FK_booth_receptionists_tenant"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_booth_receptionists_tenant_user"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_booth_receptionists_tenant_booth"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "booth_receptionists"`);
  }
}
