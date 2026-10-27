# Transaction Ledger API

A small backend API for a transaction ledger. It supports creating accounts,
recording immutable credit and debit transactions, retrieving balances and
paginated transaction history, and atomically transferring money between
accounts.

Built with **Node.js, TypeScript, Express, and SQLite** (`better-sqlite3`).

## Features

- Create accounts with a server-generated ID, timestamp, and a balance of `0`.
- Credit and debit transactions with server-side balance updates.
- Duplicate protection using a unique `reference_id` per account.
- Insufficient-balance protection for debits.
- Balance and transaction history endpoints.
- History filtering by type, pagination, and latest-first sorting.
- Atomic money transfers between accounts (bonus).
- Immutable transactions enforced by the API and by database triggers.
- Consistent JSON validation and error responses.
- Swagger UI documentation at `/docs`.
- Integration tests covering the business rules and failure cases.

## Requirements

- Node.js 20 or newer
- npm

## Setup

```bash
npm install
npm run dev
```

The API starts at `http://localhost:3000`.

- Swagger UI: `http://localhost:3000/docs`
- OpenAPI spec: `http://localhost:3000/openapi.yaml`
- Health check: `http://localhost:3000/health`

The SQLite database is created automatically at `data/ledger.db`.

### Configuration

| Variable  | Default           | Description                |
| --------- | ----------------- | -------------------------- |
| `PORT`    | `3000`            | HTTP port                  |
| `DB_PATH` | `data/ledger.db`  | SQLite database file path  |

Example:

```bash
PORT=4000 DB_PATH=data/local.db npm run dev
```

### Production-style run

```bash
npm run build
npm start
```

### Tests and checks

```bash
npm test
npm run typecheck
npm run build
```

## API overview

| Method | Path                              | Description                              |
| ------ | --------------------------------- | ---------------------------------------- |
| POST   | `/accounts`                       | Create an account                        |
| GET    | `/accounts/:accountId`            | Get an account                           |
| GET    | `/accounts/:accountId/balance`    | Get the current balance                  |
| POST   | `/accounts/:accountId/transactions` | Add a credit or debit transaction      |
| GET    | `/accounts/:accountId/transactions` | List transaction history with filters  |
| POST   | `/transfers`                      | Transfer money between accounts (bonus)  |
| GET    | `/health`                         | Health check                             |

Full request/response schemas are in [`docs/openapi.yaml`](docs/openapi.yaml)
and at `/docs` when the server is running.

### Create an account

```bash
curl -X POST http://localhost:3000/accounts \
  -H 'Content-Type: application/json' \
  -d '{"name":"Alice"}'
```

```json
{
  "id": "7f9d3a68-7f4c-4f2e-8a3c-3f4a2b1c9d10",
  "name": "Alice",
  "balance": 0,
  "created_at": "2026-10-26T12:00:00.000Z"
}
```

### Add a transaction

```bash
curl -X POST http://localhost:3000/accounts/<accountId>/transactions \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "credit",
    "amount": 100,
    "description": "Invoice payment",
    "reference_id": "invoice-1001"
  }'
```

- A `credit` increases the balance by `amount`.
- A `debit` decreases the balance by `amount` and returns `422` if funds are
  insufficient.
- Reusing a `reference_id` on the same account returns `409` and changes
  nothing. The same reference may be used on different accounts.

### Get a balance

```bash
curl http://localhost:3000/accounts/<accountId>/balance
```

```json
{ "account_id": "7f9d3a68-7f4c-4f2e-8a3c-3f4a2b1c9d10", "balance": 100 }
```

### Get transaction history

```bash
curl 'http://localhost:3000/accounts/<accountId>/transactions?type=debit&page=1&limit=20'
```

```json
{
  "data": [
    {
      "id": "34a4de0c-25e9-4d1f-9e48-93fbbfa9a2b7",
      "account_id": "7f9d3a68-7f4c-4f2e-8a3c-3f4a2b1c9d10",
      "type": "debit",
      "amount": 30,
      "description": "Groceries",
      "reference_id": "purchase-1",
      "created_at": "2026-10-26T12:05:00.000Z"
    }
  ],
  "pagination": {
    "page": 1,
    "page_size": 20,
    "total_records": 1,
    "total_pages": 1
  }
}
```

`type` is optional (`credit` or `debit`). Results are always sorted by
`created_at` descending.

### Transfer money (bonus)

```bash
curl -X POST http://localhost:3000/transfers \
  -H 'Content-Type: application/json' \
  -d '{
    "from_account_id": "<aliceId>",
    "to_account_id": "<bobId>",
    "amount": 30,
    "reference_id": "transfer-2026-10-26-001"
  }'
```

The source debit and destination credit are written in one SQLite transaction.
If either side fails, neither is persisted.

## Error responses

Errors use a consistent shape:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Request validation failed.",
    "details": {
      "issues": [{ "path": "amount", "message": "amount must be greater than 0" }]
    }
  }
}
```

| HTTP | Code                   | Meaning                                      |
| ---- | ---------------------- | -------------------------------------------- |
| 400  | `VALIDATION_ERROR`     | Invalid body, query, or path parameter       |
| 400  | `INVALID_JSON`         | Malformed JSON request body                  |
| 400  | `INVALID_TRANSFER`     | Source and destination are the same account  |
| 404  | `ACCOUNT_NOT_FOUND`    | Account ID does not exist                    |
| 404  | `ROUTE_NOT_FOUND`      | Unknown route                                |
| 409  | `DUPLICATE_REFERENCE`  | Reference already used for this account      |
| 413  | `PAYLOAD_TOO_LARGE`    | Request body exceeds 100 KB                  |
| 422  | `INSUFFICIENT_BALANCE` | Debit or transfer exceeds available balance  |
| 500  | `INTERNAL_ERROR`       | Unexpected server error                      |

## Data integrity

- **Atomic writes:** each transaction inserts the ledger entry and updates the
  account balance inside a single SQLite transaction. Transfers update both
  accounts in one transaction.
- **Database constraints:** unique primary keys, positive amount checks,
  non-negative balance checks, valid transaction types, and
  `UNIQUE (account_id, reference_id)`.
- **Foreign keys:** transactions must reference an existing account and account
  deletion is restricted.
- **Immutability:** there are no update or delete endpoints. Database triggers
  also reject any `UPDATE` or `DELETE` on `transactions`.
- **Consistency checks:** a debit is validated against the balance inside the
  same transaction that writes it, and the balance update is guarded by a
  non-negative constraint.
- **Concurrency:** SQLite uses WAL mode and a busy timeout; the database
  connection serializes writes.

## Assumptions

- `amount` is a positive integer in the ledger's base unit. Decimal/fractional
  amounts are rejected.
- `description` is optional and defaults to an empty string for regular
  transactions. Transfers generate `Transfer to <name>` / `Transfer from
  <name>` when no description is supplied.
- `reference_id` is required for transactions and transfers. It identifies a
  transaction within an account, so the same value can be used on different
  accounts.
- A duplicate `reference_id` is treated as a conflict (`409`); the existing
  transaction is not returned in full, but its ID is included in the error
  details.
- The client cannot set an initial balance. Any `balance` field sent to
  `POST /accounts` is ignored.
- Account IDs and transaction IDs are server-generated UUID v4 values.
- No authentication or authorization is included; this is a focused ledger
  exercise.
- There is no delete-account endpoint. Accounts are retained so the ledger
  remains auditable.

## Project structure

```text
src/
  app.ts                  Express app, routes wiring, docs, error handler
  server.ts               Process entry point
  db.ts                   SQLite connection and schema
  errors.ts               Typed API errors
  schemas.ts              Zod request validation schemas
  types.ts                Shared domain types
  routes/
    accounts.ts           Account, balance, and transaction endpoints
    transfers.ts          Transfer endpoint
  services/
    ledger.ts             Ledger business logic and atomic operations
tests/
  ledger.test.ts          Integration tests
docs/
  openapi.yaml            OpenAPI 3 documentation
```
