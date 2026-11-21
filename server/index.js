'use strict';
const { config, validate } = require('./config');

async function main() {
  validate();
  const { migrate } = require('./migrate');
  const { bootstrapAdmin } = require('./bootstrap');
  const { createApp } = require('./app');
  const { startJobs } = require('./jobs');
  const { alert } = require('./lib/alert');

  await migrate();
  await bootstrapAdmin();
  const app = createApp();
  const server = app.listen(config.port, () => console.info(`SICC Admin listening on :${config.port} (${config.env})`));
  const stopJobs = startJobs();
  const shutdown = signal => { console.info(`${signal} received, shutting down`); stopJobs(); server.close(() => process.exit(0)); setTimeout(() => process.exit(1), 10000).unref(); };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('unhandledRejection', reason => alert('unhandled-rejection', String(reason)).catch(() => {}));
}

main().catch(error => { console.error(error.message); process.exit(1); });
