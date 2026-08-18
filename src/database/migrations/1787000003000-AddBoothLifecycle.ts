import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBoothLifecycle1787000003000 implements MigrationInterface {
  name = 'AddBoothLifecycle1787000003000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "booths"
      ADD COLUMN IF NOT EXISTS "lifecycle_status" character varying(24) NOT NULL DEFAULT 'published',
      ADD COLUMN IF NOT EXISTS "published_at" TIMESTAMP NULL,
      ADD COLUMN IF NOT EXISTS "published_by" uuid NULL
    `);

    await queryRunner.query(`
      UPDATE "booths"
      SET "lifecycle_status" = 'published', "published_at" = COALESCE("published_at", NOW())
      WHERE "lifecycle_status" IS NULL OR "lifecycle_status" = 'draft'
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_booths_tenant_lifecycle"
      ON "booths" ("tenant_id", "lifecycle_status")
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_booths_tenant_lifecycle"`);
    await queryRunner.query(`ALTER TABLE "booths" DROP COLUMN IF EXISTS "published_by"`);
    await queryRunner.query(`ALTER TABLE "booths" DROP COLUMN IF EXISTS "published_at"`);
    await queryRunner.query(`ALTER TABLE "booths" DROP COLUMN IF EXISTS "lifecycle_status"`);
  }
}
