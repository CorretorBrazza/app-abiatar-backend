import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDeviceTypeToPushTokens1787000015000 implements MigrationInterface {
  name = 'AddDeviceTypeToPushTokens1787000015000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "push_device_tokens"
      ADD COLUMN IF NOT EXISTS "device_type" varchar(20) NOT NULL DEFAULT 'web'
    `);
    // Backfill best-effort a partir do device_label já salvo (user-agent truncado)
    await queryRunner.query(`
      UPDATE "push_device_tokens"
      SET "device_type" = 'mobile'
      WHERE "device_label" ~* 'Mobi|Android|iPhone|iPad'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "push_device_tokens" DROP COLUMN IF EXISTS "device_type"`,
    );
  }
}