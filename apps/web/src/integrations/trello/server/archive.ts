import {
  ARCHIVE_TIMEOUT_MS,
  handleErrorStatus,
  type ArchiveContext,
  type ArchiveResult,
} from '@/lib/server/integrations/archive'

const TRELLO_API = 'https://api.trello.com/1'

/** Archive the linked Trello card on cascading post delete. */
export async function archiveTrelloCard(ctx: ArchiveContext): Promise<ArchiveResult> {
  const apiKey = ctx.integrationConfig.apiKey as string
  if (!apiKey) return { success: false, error: 'Missing Trello API key' }

  const params = new URLSearchParams({
    closed: 'true',
    key: apiKey,
    token: ctx.accessToken,
  })

  const response = await fetch(`${TRELLO_API}/cards/${ctx.externalId}?${params}`, {
    method: 'PUT',
    signal: AbortSignal.timeout(ARCHIVE_TIMEOUT_MS),
  })

  const err = await handleErrorStatus(response, 'Trello', 'archived')
  if (err) return err
  return { success: true, action: 'archived' }
}
