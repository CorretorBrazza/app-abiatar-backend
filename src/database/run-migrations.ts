import { AppDataSource } from './data-source';

async function run(): Promise<void> {
  try {
    await AppDataSource.initialize();
    const migrations = await AppDataSource.runMigrations();
    console.log(`[MIGRATIONS] ${migrations.length} migration(s) aplicada(s).`);
  } catch (error) {
    console.error('[MIGRATIONS] Aviso: Erro ao executar migrations na inicialização:', error);
  } finally {
    if (AppDataSource.isInitialized) {
      await AppDataSource.destroy();
    }
  }
}

void run().catch((error) => {
  console.error('[MIGRATIONS] Falha ao executar migrations:', error);
});

