import { Router } from 'express';
import { transferSchema } from '../schemas.js';
import type { LedgerService } from '../services/ledger.js';

export function createTransfersRouter(ledger: LedgerService): Router {
  const router = Router();

  router.post('/', (req, res) => {
    const input = transferSchema.parse(req.body);
    const result = ledger.transfer(input);
    res.status(201).json(result);
  });

  return router;
}
