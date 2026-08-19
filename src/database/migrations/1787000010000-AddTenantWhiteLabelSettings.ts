import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTenantWhiteLabelSettings1787000010000 implements MigrationInterface {
  name = 'AddTenantWhiteLabelSettings1787000010000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tenants" ADD COLUMN IF NOT EXISTS "settings" jsonb NOT NULL DEFAULT '{}'::jsonb`);
    await queryRunner.query(`UPDATE "tenants" SET "settings" = jsonb_build_object(
      'features', jsonb_build_object(
        'manager_management', true,
        'reception_management', true,
        'broker_management', true,
        'password_reset', true,
        'no_grace_period', true,
        'reception_booth_assignment', true,
        'institutional_messaging', true,
        'operational_push', true
      ),
      'approval', jsonb_build_object(
        'allowed_roles', jsonb_build_array('gerencia_level_2'),
        'grace_period_options', jsonb_build_array(0, 7, 15, 30)
      ),
      'cards', jsonb_build_object(
        'broker', jsonb_build_object('edit_name', true, 'reset_password', true),
        'manager', jsonb_build_object('edit_name', true, 'reset_password', true),
        'reception', jsonb_build_object('edit_name', true, 'reset_password', true, 'manage_booths', true)
      )
    )
    WHERE "settings" = '{}'::jsonb`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "tenants" DROP COLUMN IF EXISTS "settings"`);
  }
}
