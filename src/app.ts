import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import express, { type ErrorRequestHandler, type Express } from 'express';
import swaggerUi from 'swagger-ui-express';
import { parse as parseYaml } from 'yaml';
import { ZodError } from 'zod';
import type { LedgerDatabase } from './db.js';
import { ApiError } from './errors.js';
import { createAccountsRouter } from './routes/accounts.js';
import { createTransfersRouter } from './routes/transfers.js';
import { LedgerService } from './services/ledger.js';

export interface AppOptions {
  serveDocs?: boolean;
}

const DOCS_PATH = fileURLToPath(new URL('../docs/openapi.yaml', import.meta.url));

export function createApp(db: LedgerDatabase, options: AppOptions = {}): Express {
  const app = express();
  const ledger = new LedgerService(db);

  app.disable('x-powered-by');
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  app.use('/accounts', createAccountsRouter(ledger));
  app.use('/transfers', createTransfersRouter(ledger));

  if (options.serveDocs !== false && existsSync(DOCS_PATH)) {
    const spec = parseYaml(readFileSync(DOCS_PATH, 'utf8')) as Record<string, unknown>;
    app.get('/openapi.yaml', (_req, res) => {
      res.type('application/yaml').sendFile(DOCS_PATH);
    });
    app.use('/docs', swaggerUi.serve, swaggerUi.setup(spec, {
      customSiteTitle: 'Transaction Ledger API',
    }));
  }

  app.use((req, _res, next) => {
    next(
      new ApiError(404, 'ROUTE_NOT_FOUND', 'Route not found.', {
        method: req.method,
        path: req.path,
      }),
    );
  });

  app.use(errorHandler);

  return app;
}

const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (res.headersSent) {
    return;
  }

  if (error instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed.',
        details: {
          issues: error.issues.map((issue) => ({
            path: issue.path.map(String).join('.'),
            message: issue.message,
          })),
        },
      },
    });
    return;
  }

  if (error instanceof ApiError) {
    res.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    });
    return;
  }

  if (error instanceof SyntaxError && (error as SyntaxError & { type?: string }).type === 'entity.parse.failed') {
    res.status(400).json({
      error: {
        code: 'INVALID_JSON',
        message: 'Request body must be valid JSON.',
      },
    });
    return;
  }

  if ((error as { type?: string }).type === 'entity.too.large') {
    res.status(413).json({
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Request body is too large.',
      },
    });
    return;
  }

  console.error('Unexpected error:', error);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred.',
    },
  });
};
