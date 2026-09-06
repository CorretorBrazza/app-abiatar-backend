import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPresenceAttendanceQueue1787000014000 implements MigrationInterface {
  name = 'AddPresenceAttendanceQueue1787000014000';

  // ADD VALUE em enum PostgreSQL não pode rodar dentro da transação padrão do TypeORM.
  public readonly transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE presences
      ADD COLUMN IF NOT EXISTS attended_at timestamp NULL;
    `);

    await queryRunner.query(`
      ALTER TABLE presences
      ADD COLUMN IF NOT EXISTS attended_by_user_id uuid NULL;
    `);

    // Garante que nenhum corretor tenha mais de uma presença ativa antes de indexar
    await queryRunner.query(`
      WITH ranked AS (
        SELECT id,
               ROW_NUMBER() OVER (PARTITION BY broker_id, tenant_id ORDER BY check_in_at DESC) AS rn
        FROM presences
        WHERE status = 'online'
      )
      UPDATE presences SET status = 'completed'
      WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_presences_broker_active
      ON presences (broker_id, tenant_id)
      WHERE status = 'online';
    `);

    // Adiciona 'valid_reception' ao enum de resposta dos pings (resolvido pela Recepção)
    await queryRunner.query(`
      DO $$
      DECLARE t text;
      BEGIN
        SELECT pg_type.typname INTO t
        FROM pg_attribute a
        JOIN pg_class c ON c.oid = a.attrelid
        JOIN pg_type ON pg_type.oid = a.atttypid
        WHERE c.relname = 'dead_mans_switch_logs' AND a.attname = 'response_status';
        IF t IS NOT NULL THEN
          EXECUTE format('ALTER TYPE %I ADD VALUE IF NOT EXISTS ''valid_reception''', t);
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS uq_presences_broker_active;`);
    await queryRunner.query(`ALTER TABLE presences DROP COLUMN IF EXISTS attended_by_user_id;`);
    await queryRunner.query(`ALTER TABLE presences DROP COLUMN IF EXISTS attended_at;`);
  }
}

export default AddPresenceAttendanceQueue1787000014000;