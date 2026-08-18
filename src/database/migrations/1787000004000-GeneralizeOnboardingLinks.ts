import { MigrationInterface, QueryRunner } from 'typeorm';

export class GeneralizeOnboardingLinks1787000004000 implements MigrationInterface {
  name = 'GeneralizeOnboardingLinks1787000004000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "manager_onboarding_links" ALTER COLUMN "manager_id" DROP NOT NULL`);
    await queryRunner.query(`ALTER TABLE "manager_onboarding_links" ADD COLUMN IF NOT EXISTS "inviter_id" uuid NULL`);
    await queryRunner.query(`ALTER TABLE "manager_onboarding_links" ADD COLUMN IF NOT EXISTS "invited_role" character varying(24) NOT NULL DEFAULT 'corretor_level_3'`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "IDX_onboarding_links_tenant_role" ON "manager_onboarding_links" ("tenant_id", "invited_role")`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_onboarding_links_tenant_role"`);
    await queryRunner.query(`ALTER TABLE "manager_onboarding_links" DROP COLUMN IF EXISTS "invited_role"`);
    await queryRunner.query(`ALTER TABLE "manager_onboarding_links" DROP COLUMN IF EXISTS "inviter_id"`);
    await queryRunner.query(`ALTER TABLE "manager_onboarding_links" ALTER COLUMN "manager_id" SET NOT NULL`);
  }
}
