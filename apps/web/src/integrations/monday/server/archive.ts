import {
  ARCHIVE_TIMEOUT_MS,
  handleErrorStatus,
  type ArchiveContext,
  type ArchiveResult,
} from '@/lib/server/integrations/archive'

const MONDAY_API = 'https://api.monday.com/v2'

/** Archive the linked Monday.com item on cascading post delete. */
export async function archiveMondayItem(ctx: ArchiveContext): Promise<ArchiveResult> {
  const response = await fetch(MONDAY_API, {
    method: 'POST',
    headers: {
      Authorization: ctx.accessToken,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      query: `mutation ArchiveItem($itemId: ID!) { archive_item(item_id: $itemId) { id } }`,
      variables: { itemId: ctx.externalId },
    }),
    signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS),
  })

  const err = await handleErrorStatus(response, 'Monday', 'archived')
  if (err) return err

  const json = (await response.json()) as {
    data?: { archive_item?: { id: string } }
    errors?: Array<{ message: string }>
  }
  if (json.errors?.length) {
    return { success: false, error: json.errors[0].message }
  }
  return { success: true, action: 'archived' }
}
