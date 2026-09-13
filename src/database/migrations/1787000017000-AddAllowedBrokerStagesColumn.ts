import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAllowedBrokerStagesColumn1787000017000 implements MigrationInterface {
  name = 'AddAllowedBrokerStagesColumn1787000017000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE booth_rule_sets
      ADD COLUMN IF NOT EXISTS allowed_broker_stages jsonb NOT NULL DEFAULT '["treinamento","estagiario","corretor_creci"]'::jsonb;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE booth_rule_sets
      DROP COLUMN IF EXISTS allowed_broker_stages;
    `);
  }
}

export default AddAllowedBrokerStagesColumn1787000017000;