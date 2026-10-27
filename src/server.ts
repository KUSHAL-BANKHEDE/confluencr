import { createApp } from './app.js';
import { createDatabase } from './db.js';

const port = Number(process.env.PORT ?? 3000);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535.');
}

const db = createDatabase();
const app = createApp(db);

const server = app.listen(port, () => {
  console.log(`Transaction Ledger API listening on http://localhost:${port}`);
  console.log(`API docs available at http://localhost:${port}/docs`);
});

const shutdown = (signal: string): void => {
  console.log(`\nReceived ${signal}, shutting down...`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
};

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
