/** Messages in this class are authored for people, never copied from provider/SQL errors. */
export class SyncRequestError extends Error {}

export async function publicSyncResult<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof SyncRequestError) throw new Error(error.message)
    throw new Error('Could not complete this sync request. Refresh and try again.')
  }
}
