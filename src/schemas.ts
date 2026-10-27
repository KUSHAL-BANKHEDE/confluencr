import { z } from 'zod';

export const idSchema = z.string().trim().min(1, 'id is required').max(100, 'id is too long');

export const createAccountSchema = z.object({
  name: z
    .string({ error: 'name is required' })
    .trim()
    .min(1, 'name is required')
    .max(100, 'name must be at most 100 characters'),
});

export const createTransactionSchema = z.object({
  type: z.enum(['credit', 'debit'], {
    error: "type must be either 'credit' or 'debit'",
  }),
  amount: z
    .number({ error: 'amount must be a number' })
    .int('amount must be an integer')
    .positive('amount must be greater than 0'),
  description: z
    .string({ error: 'description must be a string' })
    .trim()
    .max(500, 'description must be at most 500 characters')
    .optional()
    .default(''),
  reference_id: z
    .string({ error: 'reference_id is required' })
    .trim()
    .min(1, 'reference_id is required')
    .max(100, 'reference_id must be at most 100 characters'),
});

export const transactionQuerySchema = z.object({
  type: z.enum(['credit', 'debit'], {
    error: "type must be either 'credit' or 'debit'",
  }).optional(),
  page: z.coerce
    .number({ error: 'page must be a number' })
    .int('page must be an integer')
    .min(1, 'page must be greater than or equal to 1')
    .optional()
    .default(1),
  limit: z.coerce
    .number({ error: 'limit must be a number' })
    .int('limit must be an integer')
    .min(1, 'limit must be greater than or equal to 1')
    .max(100, 'limit must be less than or equal to 100')
    .optional()
    .default(20),
});

export const transferSchema = z.object({
  from_account_id: z
    .string({ error: 'from_account_id is required' })
    .trim()
    .min(1, 'from_account_id is required')
    .max(100, 'from_account_id is too long'),
  to_account_id: z
    .string({ error: 'to_account_id is required' })
    .trim()
    .min(1, 'to_account_id is required')
    .max(100, 'to_account_id is too long'),
  amount: z
    .number({ error: 'amount must be a number' })
    .int('amount must be an integer')
    .positive('amount must be greater than 0'),
  description: z
    .string({ error: 'description must be a string' })
    .trim()
    .max(500, 'description must be at most 500 characters')
    .optional(),
  reference_id: z
    .string({ error: 'reference_id is required' })
    .trim()
    .min(1, 'reference_id is required')
    .max(100, 'reference_id must be at most 100 characters'),
});

export type CreateAccountInput = z.infer<typeof createAccountSchema>;
export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;
export type TransactionQuery = z.infer<typeof transactionQuerySchema>;
export type TransferInput = z.infer<typeof transferSchema>;
