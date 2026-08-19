import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPasswordResetState1787000008000 implements MigrationInterface {
  name = 'AddPasswordResetState1787000008000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "must_change_password" boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS "password_reset_expires_at" TIMESTAMP NULL,
      ADD COLUMN IF NOT EXISTS "session_version" integer NOT NULL DEFAULT 0
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "password_reset_expires_at"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "must_change_password"`);
    await queryRunner.query(`ALTER TABLE "users" DROP COLUMN IF EXISTS "session_version"`);
  }
}
