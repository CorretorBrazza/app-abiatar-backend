import { AppDataSource } from './data-source';

export interface MigrationsResult {
  applied: number;
}

export async function runPendingMigrations(): Promise<MigrationsResult> {
  try {
    await AppDataSource.initialize();
    const migrations = await AppDataSource.runMigrations();
    console.log(`[MIGRATIONS] ${migrations.length} migration(s) aplicada(s).`);
    return { applied: migrations.length };
  } catch (error) {
    console.error('[MIGRATIONS] Aviso: Erro ao executar migrations na inicialização:', error);
    return { applied: -1 };
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