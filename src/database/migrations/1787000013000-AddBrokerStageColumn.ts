import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddBrokerStageColumn1787000013000 implements MigrationInterface {
  name = 'AddBrokerStageColumn1787000013000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('users');
    if (!table) return;

    if (!table.findColumnByName('broker_stage')) {
      await queryRunner.addColumn('users', new TableColumn({
        name: 'broker_stage',
        type: 'varchar',
        length: '32',
        isNullable: false,
        default: "'corretor_creci'",
      }));
    }

    const creciCol = table.findColumnByName('creci');
    if (creciCol && !creciCol.isNullable) {
      await queryRunner.changeColumn('users', 'creci', new TableColumn({
        name: 'creci',
        type: 'varchar',
        length: '255',
        isNullable: true,
      }));
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('users');
    if (table?.findColumnByName('broker_stage')) {
      await queryRunner.dropColumn('users', 'broker_stage');
    }
  }
}

export default AddBrokerStageColumn1787000013000;
