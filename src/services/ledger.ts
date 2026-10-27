import { randomUUID } from 'node:crypto';
import type { LedgerDatabase } from '../db.js';
import {
  ApiError,
  accountNotFound,
  duplicateReference,
  insufficientBalance,
} from '../errors.js';
import type {
  CreateTransactionInput,
  TransactionQuery,
  TransferInput,
} from '../schemas.js';
import type {
  Account,
  PaginationMeta,
  Transaction,
  TransactionHistory,
} from '../types.js';

interface TransactionRow {
  id: string;
  account_id: string;
  type: 'credit' | 'debit';
  amount: number;
  description: string;
  reference_id: string;
  created_at: string;
}

interface CountRow {
  total: number;
}

interface IdRow {
  id: string;
}

export interface TransferResult {
  reference_id: string;
  from: { account_id: string; balance: number };
  to: { account_id: string; balance: number };
  debit: Transaction;
  credit: Transaction;
}

export class LedgerService {
  constructor(private readonly db: LedgerDatabase) {}

  createAccount(name: string): Account {
    const account: Account = {
      id: randomUUID(),
      name,
      balance: 0,
      created_at: new Date().toISOString(),
    };

    this.db
      .prepare('INSERT INTO accounts (id, name, balance, created_at) VALUES (?, ?, ?, ?)')
      .run(account.id, account.name, account.balance, account.created_at);

    return account;
  }

  getAccount(accountId: string): Account {
    const account = this.db
      .prepare('SELECT id, name, balance, created_at FROM accounts WHERE id = ?')
      .get(accountId) as Account | undefined;

    if (!account) {
      throw accountNotFound(accountId);
    }

    return account;
  }

  getBalance(accountId: string): { account_id: string; balance: number } {
    const account = this.getAccount(accountId);
    return { account_id: account.id, balance: account.balance };
  }

  listTransactions(accountId: string, query: TransactionQuery): TransactionHistory {
    this.getAccount(accountId);

    const filters = ['account_id = ?'];
    const params: Array<string> = [accountId];

    if (query.type) {
      filters.push('type = ?');
      params.push(query.type);
    }

    const where = filters.join(' AND ');
    const countRow = this.db
      .prepare(`SELECT COUNT(*) AS total FROM transactions WHERE ${where}`)
      .get(...params) as CountRow;

    const offset = (query.page - 1) * query.limit;
    const rows = this.db
      .prepare(
        `SELECT id, account_id, type, amount, description, reference_id, created_at
         FROM transactions
         WHERE ${where}
         ORDER BY created_at DESC, rowid DESC
         LIMIT ? OFFSET ?`,
      )
      .all(...params, query.limit, offset) as TransactionRow[];

    const totalPages = Math.ceil(countRow.total / query.limit);

    const pagination: PaginationMeta = {
      page: query.page,
      page_size: query.limit,
      total_records: countRow.total,
      total_pages: totalPages,
    };

    return { data: rows, pagination };
  }

  addTransaction(accountId: string, input: CreateTransactionInput): Transaction {
    const execute = this.db.transaction((): Transaction => {
      const account = this.getAccount(accountId);

      const existing = this.db
        .prepare('SELECT id FROM transactions WHERE account_id = ? AND reference_id = ?')
        .get(accountId, input.reference_id) as IdRow | undefined;

      if (existing) {
        throw duplicateReference(accountId, input.reference_id, existing.id);
      }

      if (input.type === 'debit' && account.balance < input.amount) {
        throw insufficientBalance(accountId, account.balance, input.amount);
      }

      const transaction: Transaction = {
        id: randomUUID(),
        account_id: accountId,
        type: input.type,
        amount: input.amount,
        description: input.description,
        reference_id: input.reference_id,
        created_at: new Date().toISOString(),
      };

      this.insertTransaction(transaction);
      this.adjustBalance(accountId, input.type === 'credit' ? input.amount : -input.amount);

      return transaction;
    });

    try {
      return execute();
    } catch (error) {
      if (this.isUniqueConstraint(error)) {
        const existing = this.db
          .prepare('SELECT id FROM transactions WHERE account_id = ? AND reference_id = ?')
          .get(accountId, input.reference_id) as IdRow | undefined;
        throw duplicateReference(accountId, input.reference_id, existing?.id);
      }
      throw error;
    }
  }

  transfer(input: TransferInput): TransferResult {
    if (input.from_account_id === input.to_account_id) {
      throw new ApiError(
        400,
        'INVALID_TRANSFER',
        'Source and destination accounts must be different.',
      );
    }

    const execute = this.db.transaction((): TransferResult => {
      const from = this.getAccount(input.from_account_id);
      const to = this.getAccount(input.to_account_id);

      const duplicate = this.db
        .prepare(
          `SELECT account_id, id FROM transactions
           WHERE reference_id = ? AND account_id IN (?, ?)
           LIMIT 1`,
        )
        .get(input.reference_id, from.id, to.id) as
        | { account_id: string; id: string }
        | undefined;

      if (duplicate) {
        throw duplicateReference(duplicate.account_id, input.reference_id, duplicate.id);
      }

      if (from.balance < input.amount) {
        throw insufficientBalance(from.id, from.balance, input.amount);
      }

      const createdAt = new Date().toISOString();

      const debit: Transaction = {
        id: randomUUID(),
        account_id: from.id,
        type: 'debit',
        amount: input.amount,
        description: input.description ?? `Transfer to ${to.name}`,
        reference_id: input.reference_id,
        created_at: createdAt,
      };

      const credit: Transaction = {
        id: randomUUID(),
        account_id: to.id,
        type: 'credit',
        amount: input.amount,
        description: input.description ?? `Transfer from ${from.name}`,
        reference_id: input.reference_id,
        created_at: createdAt,
      };

      this.insertTransaction(debit);
      this.insertTransaction(credit);
      this.adjustBalance(from.id, -input.amount);
      this.adjustBalance(to.id, input.amount);

      return {
        reference_id: input.reference_id,
        from: { account_id: from.id, balance: from.balance - input.amount },
        to: { account_id: to.id, balance: to.balance + input.amount },
        debit,
        credit,
      };
    });

    try {
      return execute();
    } catch (error) {
      if (this.isUniqueConstraint(error)) {
        const duplicate = this.db
          .prepare(
            `SELECT account_id, id FROM transactions
             WHERE reference_id = ? AND account_id IN (?, ?)
             LIMIT 1`,
          )
          .get(input.reference_id, input.from_account_id, input.to_account_id) as
          | { account_id: string; id: string }
          | undefined;

        if (duplicate) {
          throw duplicateReference(
            duplicate.account_id,
            input.reference_id,
            duplicate.id,
          );
        }
      }
      throw error;
    }
  }

  private insertTransaction(transaction: Transaction): void {
    this.db
      .prepare(
        `INSERT INTO transactions
           (id, account_id, type, amount, description, reference_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        transaction.id,
        transaction.account_id,
        transaction.type,
        transaction.amount,
        transaction.description,
        transaction.reference_id,
        transaction.created_at,
      );
  }

  private adjustBalance(accountId: string, delta: number): void {
    const result = this.db
      .prepare('UPDATE accounts SET balance = balance + ? WHERE id = ?')
      .run(delta, accountId);

    if (result.changes !== 1) {
      throw accountNotFound(accountId);
    }
  }

  private isUniqueConstraint(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    const code = (error as Error & { code?: string }).code;
    return code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT_PRIMARYKEY';
  }
}
