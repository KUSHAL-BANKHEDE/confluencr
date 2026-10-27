export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const accountNotFound = (accountId: string): ApiError =>
  new ApiError(404, 'ACCOUNT_NOT_FOUND', 'Account not found.', { account_id: accountId });

export const duplicateReference = (
  accountId: string,
  referenceId: string,
  existingTransactionId?: string,
): ApiError =>
  new ApiError(
    409,
    'DUPLICATE_REFERENCE',
    'A transaction with this reference_id already exists for the account.',
    {
      account_id: accountId,
      reference_id: referenceId,
      ...(existingTransactionId ? { existing_transaction_id: existingTransactionId } : {}),
    },
  );

export const insufficientBalance = (accountId: string, balance: number, amount: number): ApiError =>
  new ApiError(422, 'INSUFFICIENT_BALANCE', 'The account has insufficient balance.', {
    account_id: accountId,
    balance,
    requested_amount: amount,
  });
