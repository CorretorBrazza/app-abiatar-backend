import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBrokerStageColumn1787000013000 implements MigrationInterface {
  name = 'AddBrokerStageColumn1787000013000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS broker_stage varchar(32) NOT NULL DEFAULT 'corretor_creci';
    `);

    await queryRunner.query(`
      ALTER TABLE users 
      ALTER COLUMN creci DROP NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users 
      DROP COLUMN IF EXISTS broker_stage;
    `);
  }
}

export default AddBrokerStageColumn1787000013000;
