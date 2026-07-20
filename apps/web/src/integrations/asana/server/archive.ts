import {
  ARCHIVE_TIMEOUT_MS,
  handleErrorStatus,
  type ArchiveContext,
  type ArchiveResult,
} from '@/lib/server/integrations/archive'

const ASANA_API = 'https://app.asana.com/api/1.0'

/** Mark the linked Asana task complete on cascading post delete. */
export async function completeAsanaTask(ctx: ArchiveContext): Promise<ArchiveResult> {
  const response = await fetch(`${ASANA_API}/tasks/${ctx.externalId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${ctx.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ data: { completed: true } }),
    signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS),
  })

  const err = await handleErrorStatus(response, 'Asana', 'closed')
  if (err) return err
  return { success: true, action: 'closed' }
}
