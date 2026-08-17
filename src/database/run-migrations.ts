import { AppDataSource } from './data-source';

async function run(): Promise<void> {
  try {
    await AppDataSource.initialize();
    const migrations = await AppDataSource.runMigrations();
    console.log(`[MIGRATIONS] ${migrations.length} migration(s) aplicada(s).`);
  } finally {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }
}

void run().catch((error) => {
  console.error('[MIGRATIONS] Falha ao executar migrations:', error);
  process.exitCode = 1;
});
