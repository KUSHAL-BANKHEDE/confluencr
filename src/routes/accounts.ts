import { Router } from 'express';
import {
  createAccountSchema,
  createTransactionSchema,
  idSchema,
  transactionQuerySchema,
} from '../schemas.js';
import type { LedgerService } from '../services/ledger.js';

export function createAccountsRouter(ledger: LedgerService): Router {
  const router = Router();

  router.post('/', (req, res) => {
    const { name } = createAccountSchema.parse(req.body);
    const account = ledger.createAccount(name);
    res.status(201).json(account);
  });

  router.get('/:accountId', (req, res) => {
    const accountId = idSchema.parse(req.params.accountId);
    res.json(ledger.getAccount(accountId));
  });

  router.get('/:accountId/balance', (req, res) => {
    const accountId = idSchema.parse(req.params.accountId);
    res.json(ledger.getBalance(accountId));
  });

  router.get('/:accountId/transactions', (req, res) => {
    const accountId = idSchema.parse(req.params.accountId);
    const query = transactionQuerySchema.parse(req.query);
    res.json(ledger.listTransactions(accountId, query));
  });

  router.post('/:accountId/transactions', (req, res) => {
    const accountId = idSchema.parse(req.params.accountId);
    const input = createTransactionSchema.parse(req.body);
    const transaction = ledger.addTransaction(accountId, input);
    res.status(201).json(transaction);
  });

  return router;
}
