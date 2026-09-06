import { Migration, MigrationExecutor } from 'typeorm';
import { AppDataSource } from './data-source';

export interface MigrationsResult {
  applied: number;
}

// Migrations anteriores ao synchronize (aplicadas pelo auto-heal do schema em dev/prod).
// Se não estiverem registradas na tabela de migrations, tentamos executá-las;
// se falharem porque o schema já existe, marcamos como executadas (baseline).
const BASELINE_MIGRATION_NAMES = new Set([
  'CreateAuditLogs1787000000000',
  'AddReceptionAssignments1787000001000',
  'AddBoothRuleSets1787000002000',
  'AddBoothLifecycle1787000003000',
  'GeneralizeOnboardingLinks1787000004000',
  'ConfigurePresenceConfirmationWindow1787000005000',
  'AddBrokerManagementState1787000006000',
  'CleanupAbiatarTestUsers1787000007000',
  'AddPasswordResetState1787000008000',
  'ResetAbiatarTestForRecreation1787000009000',
  'AddTenantWhiteLabelSettings1787000010000',
  'AddPresenceConfirmationCycle1787000011000',
  'AddBoothRulePeriods1787000012000',
  'AddBrokerStageColumn1787000013000',
]);

export async function runPendingMigrations(): Promise<MigrationsResult> {
  if (!AppDataSource.isInitialized) {
    await AppDataSource.initialize();
  }
  try {
    const executor = new MigrationExecutor(AppDataSource);

    let executedNames: string[] = [];
    try {
      const executed = await executor.getExecutedMigrations();
      executedNames = executed.map((m) => m.name);
    } catch {
      // Tabela de migrations ainda não existe — nenhuma executada.
    }

    const pending = (AppDataSource.migrations as unknown as Migration[]).filter(
      (m) => !executedNames.includes(m.name),
    );
    let applied = 0;

    for (const migration of pending) {
      const isCritical = !BASELINE_MIGRATION_NAMES.has(migration.name);
      try {
        await executor.executeMigration(migration);
        applied++;
        console.log(`[MIGRATIONS] ${migration.name} aplicada com sucesso.`);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        if (isCritical) {
          console.error(`[MIGRATIONS] CRÍTICO: ${migration.name} FALHOU: ${message}`);
          throw error;
        }
        console.warn(
          `[MIGRATIONS] ${migration.name} já estava aplicada pelo synchronize (baseline); registrando como executada. ${message}`,
        );
        await AppDataSource.query(
          'INSERT INTO migrations (timestamp, name) VALUES ($1, $2)',
          [migration.timestamp, migration.name],
        );
      }
    }

    console.log(`[MIGRATIONS] ${applied} migration(s) nova(s) aplicada(s).`);
    return { applied };
  } finally {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }
}

// Execução direta quando chamado como script: npx ts-node src/database/run-migrations.ts
if (require.main === module) {
  void runPendingMigrations().catch((error) => {
    console.error('[MIGRATIONS] Falha ao executar migrations:', error);
  });
}