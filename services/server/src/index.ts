import { pathToFileURL } from 'node:url';
import { buildServer } from './app.ts';
import { loadConfig } from './config.ts';
import { createDb } from './db.ts';
import { createLogger } from './logger.ts';
import { runMigrations } from './migrate.ts';

export * from './app.ts';
export * from './auth.ts';
export * from './broadcaster.ts';
export * from './cli.ts';
export * from './config.ts';
export * from './db.ts';
export * from './logger.ts';
export * from './migrate.ts';
export * from './pipeline.ts';
export * from './ws.ts';

export async function startServer(env: NodeJS.ProcessEnv = process.env): Promise<{ stop: () => Promise<void>; address: string }> {
  const config = loadConfig(env);
  const logger = createLogger(config.logLevel);
  const { db, pool, close } = createDb(config.databaseUrl);

  if (config.autoMigrate) {
    const result = await runMigrations(pool);
    if (result.appliedNow.length > 0) {
      logger.info({ applied: result.appliedNow }, 'Applied database migrations');
    }
  }

  const { app } = buildServer({ config, db, pool, logger });
  const address = await app.listen({ host: config.host, port: config.port });
  logger.info({ address }, 'Server listening');

  const stop = async () => {
    await app.close();
    await close();
  };

  return { stop, address };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { stop } = await startServer();
  const shutdown = async () => {
    await stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
