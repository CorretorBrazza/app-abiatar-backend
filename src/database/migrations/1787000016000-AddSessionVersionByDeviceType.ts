import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSessionVersionByDeviceType1787000016000 implements MigrationInterface {
  name = 'AddSessionVersionByDeviceType1787000016000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "session_version_mobile" integer NOT NULL DEFAULT 0
    `);
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "session_version_web" integer NOT NULL DEFAULT 0
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "session_version_web"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "session_version_mobile"`);
  }
}