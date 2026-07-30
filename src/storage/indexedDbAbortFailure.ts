import { rt } from '../i18n'

export function abortIndexedDbTransactionOrReject(
  transaction: Pick<IDBTransaction, 'abort'> | undefined,
  operationError: unknown,
  reject: (error: unknown) => void,
): void {
  if (!transaction) {
    reject(operationError)
    return
  }

  try {
    transaction.abort()
  } catch (abortError: unknown) {
    reject(
      new AggregateError(
        [operationError, abortError],
        rt('error.localStorageAbortStateUnknown'),
        { cause: abortError },
      ),
    )
  }
}
