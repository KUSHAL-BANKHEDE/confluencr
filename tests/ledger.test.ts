import type { Express } from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { createDatabase, type LedgerDatabase } from '../src/db.js';
import type { Account, Transaction, TransactionHistory } from '../src/types.js';

let db: LedgerDatabase;
let app: Express;

beforeEach(() => {
  db = createDatabase(':memory:');
  app = createApp(db, { serveDocs: false });
});

afterEach(() => {
  db.close();
});

async function createAccount(name = 'Alice'): Promise<Account> {
  const response = await request(app).post('/accounts').send({ name }).expect(201);
  return response.body as Account;
}

function addTransaction(accountId: string, body: Record<string, unknown>) {
  return request(app).post(`/accounts/${accountId}/transactions`).send(body);
}

async function getBalance(accountId: string): Promise<number> {
  const response = await request(app).get(`/accounts/${accountId}/balance`).expect(200);
  return (response.body as { balance: number }).balance;
}

async function getHistory(
  accountId: string,
  query: Record<string, string | number> = {},
): Promise<TransactionHistory> {
  const response = await request(app)
    .get(`/accounts/${accountId}/transactions`)
    .query(query)
    .expect(200);
  return response.body as TransactionHistory;
}

describe('accounts', () => {
  it('creates an account with a zero balance and server timestamp, ignoring client balance', async () => {
    const response = await request(app)
      .post('/accounts')
      .send({ name: 'Alice', balance: 999 })
      .expect(201);

    const account = response.body as Account;

    expect(account.id).toBeTypeOf('string');
    expect(account.name).toBe('Alice');
    expect(account.balance).toBe(0);
    expect(Number.isNaN(Date.parse(account.created_at))).toBe(false);
  });

  it('trims the account name', async () => {
    const account = await createAccount('  Bob  ');
    expect(account.name).toBe('Bob');
  });

  it('rejects a missing or blank name', async () => {
    const missing = await request(app).post('/accounts').send({}).expect(400);
    expect(missing.body.error.code).toBe('VALIDATION_ERROR');

    const blank = await request(app).post('/accounts').send({ name: '   ' }).expect(400);
    expect(blank.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns an account by id', async () => {
    const account = await createAccount();
    const response = await request(app).get(`/accounts/${account.id}`).expect(200);
    expect(response.body).toMatchObject({ id: account.id, name: 'Alice', balance: 0 });
  });

  it('returns 404 for an unknown account', async () => {
    const missingId = '00000000-0000-0000-0000-000000000000';

    const account = await request(app).get(`/accounts/${missingId}`).expect(404);
    expect(account.body.error.code).toBe('ACCOUNT_NOT_FOUND');

    const balance = await request(app).get(`/accounts/${missingId}/balance`).expect(404);
    expect(balance.body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });
});

describe('transactions', () => {
  it('applies credits and debits to the balance', async () => {
    const account = await createAccount();

    await addTransaction(account.id, {
      type: 'credit',
      amount: 100,
      reference_id: 'credit-1',
    }).expect(201);

    await addTransaction(account.id, {
      type: 'debit',
      amount: 30,
      reference_id: 'debit-1',
    }).expect(201);

    expect(await getBalance(account.id)).toBe(70);
  });

  it('stores the transaction fields and defaults an omitted description', async () => {
    const account = await createAccount();
    const response = await addTransaction(account.id, {
      type: 'credit',
      amount: 50,
      reference_id: 'invoice-1',
    }).expect(201);

    const transaction = response.body as Transaction;
    expect(transaction).toMatchObject({
      account_id: account.id,
      type: 'credit',
      amount: 50,
      description: '',
      reference_id: 'invoice-1',
    });
    expect(transaction.id).toBeTypeOf('string');
    expect(Number.isNaN(Date.parse(transaction.created_at))).toBe(false);
  });

  it('rejects a debit with insufficient balance without changing anything', async () => {
    const account = await createAccount();
    await addTransaction(account.id, {
      type: 'credit',
      amount: 100,
      reference_id: 'credit-1',
    }).expect(201);

    const response = await addTransaction(account.id, {
      type: 'debit',
      amount: 150,
      reference_id: 'debit-1',
    }).expect(422);

    expect(response.body.error.code).toBe('INSUFFICIENT_BALANCE');
    expect(response.body.error.details).toMatchObject({
      balance: 100,
      requested_amount: 150,
    });
    expect(await getBalance(account.id)).toBe(100);

    const history = await getHistory(account.id);
    expect(history.pagination.total_records).toBe(1);
  });

  it('rejects invalid transaction payloads', async () => {
    const account = await createAccount();
    const invalidPayloads = [
      { type: 'transfer', amount: 10, reference_id: 'ref-1' },
      { type: 'credit', amount: 0, reference_id: 'ref-1' },
      { type: 'credit', amount: -5, reference_id: 'ref-1' },
      { type: 'credit', amount: 1.5, reference_id: 'ref-1' },
      { type: 'credit', amount: '10', reference_id: 'ref-1' },
      { type: 'credit', amount: 10, reference_id: '   ' },
      { type: 'credit', amount: 10 },
    ];

    for (const payload of invalidPayloads) {
      const response = await addTransaction(account.id, payload).expect(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }

    expect(await getBalance(account.id)).toBe(0);
  });

  it('returns 404 when adding a transaction to a missing account', async () => {
    const response = await addTransaction('00000000-0000-0000-0000-000000000000', {
      type: 'credit',
      amount: 10,
      reference_id: 'ref-1',
    }).expect(404);

    expect(response.body.error.code).toBe('ACCOUNT_NOT_FOUND');
  });

  it('rejects duplicate reference ids for the same account without changing the balance', async () => {
    const account = await createAccount();
    const payload = {
      type: 'credit',
      amount: 100,
      reference_id: 'invoice-1',
      description: 'First attempt',
    };

    await addTransaction(account.id, payload).expect(201);

    const duplicate = await addTransaction(account.id, {
      ...payload,
      amount: 500,
      description: 'Retry',
    }).expect(409);

    expect(duplicate.body.error.code).toBe('DUPLICATE_REFERENCE');
    expect(duplicate.body.error.details.reference_id).toBe('invoice-1');
    expect(await getBalance(account.id)).toBe(100);

    const history = await getHistory(account.id);
    expect(history.pagination.total_records).toBe(1);
    expect(history.data[0]?.description).toBe('First attempt');
  });

  it('allows the same reference id on different accounts', async () => {
    const alice = await createAccount('Alice');
    const bob = await createAccount('Bob');

    await addTransaction(alice.id, {
      type: 'credit',
      amount: 10,
      reference_id: 'shared-ref',
    }).expect(201);

    await addTransaction(bob.id, {
      type: 'credit',
      amount: 20,
      reference_id: 'shared-ref',
    }).expect(201);

    expect(await getBalance(alice.id)).toBe(10);
    expect(await getBalance(bob.id)).toBe(20);
  });

  it('keeps transactions immutable at the database level', async () => {
    const account = await createAccount();
    const response = await addTransaction(account.id, {
      type: 'credit',
      amount: 10,
      reference_id: 'ref-1',
    }).expect(201);

    const transaction = response.body as Transaction;

    expect(() =>
      db.prepare('UPDATE transactions SET amount = 999 WHERE id = ?').run(transaction.id),
    ).toThrow(/immutable/);

    expect(() =>
      db.prepare('DELETE FROM transactions WHERE id = ?').run(transaction.id),
    ).toThrow(/immutable/);

    expect(await getBalance(account.id)).toBe(10);
  });
});

describe('transaction history', () => {
  it('returns both types by default and filters by type', async () => {
    const account = await createAccount();

    await addTransaction(account.id, {
      type: 'credit',
      amount: 100,
      reference_id: 'credit-1',
    }).expect(201);
    await addTransaction(account.id, {
      type: 'debit',
      amount: 25,
      reference_id: 'debit-1',
    }).expect(201);
    await addTransaction(account.id, {
      type: 'credit',
      amount: 10,
      reference_id: 'credit-2',
    }).expect(201);

    const all = await getHistory(account.id);
    expect(all.data).toHaveLength(3);
    expect(all.pagination).toEqual({
      page: 1,
      page_size: 20,
      total_records: 3,
      total_pages: 1,
    });

    const credits = await getHistory(account.id, { type: 'credit' });
    expect(credits.data).toHaveLength(2);
    expect(credits.data.every((transaction) => transaction.type === 'credit')).toBe(true);

    const debits = await getHistory(account.id, { type: 'debit' });
    expect(debits.data).toHaveLength(1);
    expect(debits.data[0]?.type).toBe('debit');
  });

  it('paginates results and reports pagination metadata', async () => {
    const account = await createAccount();

    for (let index = 1; index <= 5; index += 1) {
      await addTransaction(account.id, {
        type: 'credit',
        amount: index,
        reference_id: `ref-${index}`,
      }).expect(201);
    }

    const page1 = await getHistory(account.id, { page: 1, limit: 2 });
    expect(page1.data).toHaveLength(2);
    expect(page1.pagination).toEqual({
      page: 1,
      page_size: 2,
      total_records: 5,
      total_pages: 3,
    });

    const page3 = await getHistory(account.id, { page: 3, limit: 2 });
    expect(page3.data).toHaveLength(1);
    expect(page3.pagination.page).toBe(3);

    const beyond = await getHistory(account.id, { page: 9, limit: 2 });
    expect(beyond.data).toHaveLength(0);
    expect(beyond.pagination.total_records).toBe(5);
  });

  it('returns transactions latest-first by created_at', async () => {
    const account = await createAccount();

    for (let index = 1; index <= 3; index += 1) {
      await addTransaction(account.id, {
        type: 'credit',
        amount: index,
        reference_id: `ref-${index}`,
      }).expect(201);
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const history = await getHistory(account.id);
    expect(history.data.map((transaction) => transaction.reference_id)).toEqual([
      'ref-3',
      'ref-2',
      'ref-1',
    ]);

    const timestamps = history.data.map((transaction) => transaction.created_at);
    const sorted = [...timestamps].sort().reverse();
    expect(timestamps).toEqual(sorted);
  });

  it('rejects invalid pagination parameters', async () => {
    const account = await createAccount();

    for (const query of [
      { page: 0 },
      { page: -1 },
      { page: 'abc' },
      { page: 1.5 },
      { limit: 0 },
      { limit: 101 },
      { limit: 'abc' },
    ]) {
      const response = await request(app)
        .get(`/accounts/${account.id}/transactions`)
        .query(query)
        .expect(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('rejects an invalid type filter', async () => {
    const account = await createAccount();
    const response = await request(app)
      .get(`/accounts/${account.id}/transactions`)
      .query({ type: 'other' })
      .expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('transfers', () => {
  it('moves money atomically and records both transactions', async () => {
    const alice = await createAccount('Alice');
    const bob = await createAccount('Bob');

    await addTransaction(alice.id, {
      type: 'credit',
      amount: 100,
      reference_id: 'alice-credit',
    }).expect(201);
    await addTransaction(bob.id, {
      type: 'credit',
      amount: 50,
      reference_id: 'bob-credit',
    }).expect(201);

    const response = await request(app)
      .post('/transfers')
      .send({
        from_account_id: alice.id,
        to_account_id: bob.id,
        amount: 30,
        reference_id: 'transfer-1',
      })
      .expect(201);

    expect(response.body).toMatchObject({
      reference_id: 'transfer-1',
      from: { account_id: alice.id, balance: 70 },
      to: { account_id: bob.id, balance: 80 },
      debit: {
        account_id: alice.id,
        type: 'debit',
        amount: 30,
        reference_id: 'transfer-1',
      },
      credit: {
        account_id: bob.id,
        type: 'credit',
        amount: 30,
        reference_id: 'transfer-1',
      },
    });

    expect(await getBalance(alice.id)).toBe(70);
    expect(await getBalance(bob.id)).toBe(80);

    const aliceHistory = await getHistory(alice.id);
    const bobHistory = await getHistory(bob.id);
    expect(aliceHistory.data[0]?.description).toBe('Transfer to Bob');
    expect(bobHistory.data[0]?.description).toBe('Transfer from Alice');
  });

  it('rejects a transfer with insufficient balance without changing either account', async () => {
    const alice = await createAccount('Alice');
    const bob = await createAccount('Bob');

    await addTransaction(alice.id, {
      type: 'credit',
      amount: 100,
      reference_id: 'alice-credit',
    }).expect(201);

    const response = await request(app)
      .post('/transfers')
      .send({
        from_account_id: alice.id,
        to_account_id: bob.id,
        amount: 150,
        reference_id: 'transfer-1',
      })
      .expect(422);

    expect(response.body.error.code).toBe('INSUFFICIENT_BALANCE');
    expect(await getBalance(alice.id)).toBe(100);
    expect(await getBalance(bob.id)).toBe(0);

    expect((await getHistory(alice.id)).pagination.total_records).toBe(1);
    expect((await getHistory(bob.id)).pagination.total_records).toBe(0);
  });

  it('returns 404 and changes nothing when an account is missing', async () => {
    const alice = await createAccount('Alice');
    await addTransaction(alice.id, {
      type: 'credit',
      amount: 100,
      reference_id: 'alice-credit',
    }).expect(201);

    const response = await request(app)
      .post('/transfers')
      .send({
        from_account_id: alice.id,
        to_account_id: '00000000-0000-0000-0000-000000000000',
        amount: 30,
        reference_id: 'transfer-1',
      })
      .expect(404);

    expect(response.body.error.code).toBe('ACCOUNT_NOT_FOUND');
    expect(await getBalance(alice.id)).toBe(100);
  });

  it('rejects transfers to the same account', async () => {
    const alice = await createAccount('Alice');
    await addTransaction(alice.id, {
      type: 'credit',
      amount: 100,
      reference_id: 'alice-credit',
    }).expect(201);

    const response = await request(app)
      .post('/transfers')
      .send({
        from_account_id: alice.id,
        to_account_id: alice.id,
        amount: 30,
        reference_id: 'transfer-1',
      })
      .expect(400);

    expect(response.body.error.code).toBe('INVALID_TRANSFER');
    expect(await getBalance(alice.id)).toBe(100);
  });

  it('rejects a duplicate transfer reference without changing balances', async () => {
    const alice = await createAccount('Alice');
    const bob = await createAccount('Bob');

    await addTransaction(alice.id, {
      type: 'credit',
      amount: 100,
      reference_id: 'alice-credit',
    }).expect(201);

    const transfer = {
      from_account_id: alice.id,
      to_account_id: bob.id,
      amount: 30,
      reference_id: 'transfer-1',
    };

    await request(app).post('/transfers').send(transfer).expect(201);

    const duplicate = await request(app).post('/transfers').send(transfer).expect(409);
    expect(duplicate.body.error.code).toBe('DUPLICATE_REFERENCE');

    expect(await getBalance(alice.id)).toBe(70);
    expect(await getBalance(bob.id)).toBe(30);
  });

  it('rolls back the debit when the credit insert fails', async () => {
    const alice = await createAccount('Alice');
    const bob = await createAccount('Bob');

    await addTransaction(alice.id, {
      type: 'credit',
      amount: 100,
      reference_id: 'alice-credit',
    }).expect(201);

    db.exec(`
      CREATE TRIGGER force_credit_failure
      BEFORE INSERT ON transactions
      WHEN NEW.type = 'credit' AND NEW.account_id = '${bob.id}'
      BEGIN
        SELECT RAISE(ABORT, 'forced credit failure');
      END;
    `);

    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await request(app)
      .post('/transfers')
      .send({
        from_account_id: alice.id,
        to_account_id: bob.id,
        amount: 30,
        reference_id: 'transfer-failure',
      })
      .expect(500);

    consoleError.mockRestore();

    expect(await getBalance(alice.id)).toBe(100);
    expect(await getBalance(bob.id)).toBe(0);
    expect((await getHistory(alice.id)).pagination.total_records).toBe(1);
    expect((await getHistory(bob.id)).pagination.total_records).toBe(0);
  });
});

describe('errors and health', () => {
  it('reports health', async () => {
    const response = await request(app).get('/health').expect(200);
    expect(response.body).toEqual({ status: 'ok' });
  });

  it('returns a consistent 404 for unknown routes', async () => {
    const response = await request(app).get('/unknown').expect(404);
    expect(response.body.error).toMatchObject({
      code: 'ROUTE_NOT_FOUND',
      message: 'Route not found.',
    });
  });

  it('rejects malformed JSON', async () => {
    const response = await request(app)
      .post('/accounts')
      .set('Content-Type', 'application/json')
      .send('{"name":')
      .expect(400);

    expect(response.body.error.code).toBe('INVALID_JSON');
  });
});
