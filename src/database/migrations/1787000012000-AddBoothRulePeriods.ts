import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

export class AddBoothRulePeriods1787000012000 implements MigrationInterface {
  name = 'AddBoothRulePeriods1787000012000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('booth_rule_sets');
    if (!table) return;
    if (!table.findColumnByName('periods')) {
      await queryRunner.addColumn('booth_rule_sets', new TableColumn({
        name: 'periods',
        type: 'jsonb',
        isNullable: false,
        default: "'[]'::jsonb",
      }));
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('booth_rule_sets');
    if (table?.findColumnByName('periods')) {
      await queryRunner.dropColumn('booth_rule_sets', 'periods');
    }
  }
}

export default AddBoothRulePeriods1787000012000;
