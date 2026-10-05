import { createApp } from './app.js';
import { config } from './config.js';
import { migrate } from './db/migrate.js';
import { pool } from './db/pool.js';
import { seed } from './db/seed.js';

async function main() {
  await migrate();
  if (process.env.SEED_ON_START === 'true') await seed();

  const server = createApp().listen(config.port, () => {
    console.log(`API listening on http://localhost:${config.port} (docs: /api/docs)`);
  });

  const shutdown = (signal) => {
    console.log(`${signal} received, shutting down`);
    server.close(() => pool.end().then(() => process.exit(0)));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});
