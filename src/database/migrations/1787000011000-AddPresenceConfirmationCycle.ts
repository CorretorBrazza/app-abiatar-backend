import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddPresenceConfirmationCycle1787000011000 implements MigrationInterface {
  name = 'AddPresenceConfirmationCycle1787000011000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('presences');
    if (!table) return;
    if (!table.findColumnByName('next_confirmation_at')) {
      await queryRunner.addColumn('presences', new TableColumn({ name: 'next_confirmation_at', type: 'timestamp', isNullable: true }));
    }
    if (!table.findColumnByName('last_confirmed_at')) {
      await queryRunner.addColumn('presences', new TableColumn({ name: 'last_confirmed_at', type: 'timestamp', isNullable: true }));
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('presences');
    if (!table) return;
    if (table.findColumnByName('last_confirmed_at')) await queryRunner.dropColumn('presences', 'last_confirmed_at');
    if (table.findColumnByName('next_confirmation_at')) await queryRunner.dropColumn('presences', 'next_confirmation_at');
  }
}

export default AddPresenceConfirmationCycle1787000011000;

