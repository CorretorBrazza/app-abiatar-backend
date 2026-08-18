import { MigrationInterface, QueryRunner } from 'typeorm';

export class ConfigurePresenceConfirmationWindow1787000005000 implements MigrationInterface {
  name = 'ConfigurePresenceConfirmationWindow1787000005000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE booth_rule_sets
      ALTER COLUMN ping_response_deadline_minutes SET DEFAULT 30
    `);
    await queryRunner.query(`
      UPDATE booth_rule_sets
      SET ping_response_deadline_minutes = 30
      WHERE ping_response_deadline_minutes = 5
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE booth_rule_sets
      SET ping_response_deadline_minutes = 5
      WHERE ping_response_deadline_minutes = 30
    `);
    await queryRunner.query(`
      ALTER TABLE booth_rule_sets
      ALTER COLUMN ping_response_deadline_minutes SET DEFAULT 5
    `);
  }
}
