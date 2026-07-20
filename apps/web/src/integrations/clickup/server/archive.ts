import {
  ARCHIVE_TIMEOUT_MS,
  handleErrorStatus,
  type ArchiveContext,
  type ArchiveResult,
} from '@/lib/server/integrations/archive'

const CLICKUP_API = 'https://api.clickup.com/api/v2'

/** Close the linked ClickUp task on cascading post delete. */
export async function closeClickUpTask(ctx: ArchiveContext): Promise<ArchiveResult> {
  const response = await fetch(`${CLICKUP_API}/task/${ctx.externalId}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${ctx.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ status: 'closed' }),
    signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS),
  })

  const err = await handleErrorStatus(response, 'ClickUp', 'closed')
  if (err) return err
  return { success: true, action: 'closed' }
}
