import { ValidationError, ServiceUnavailableError } from '@/lib/shared/errors'

/** Messages in this class are authored for people, never copied from provider/SQL errors. */
export class SyncRequestError extends Error {}

export async function publicSyncResult<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof SyncRequestError)
      throw new ValidationError('SYNC_REQUEST_REJECTED', error.message)
    throw new ServiceUnavailableError(
      'SYNC_REQUEST_FAILED',
      'Could not complete this sync request. Refresh and try again.',
      error
    )
  }
}
