import { listTrelloLists } from './boards'
import type { ExternalStatusItem } from '../types'

/**
 * Trello "statuses" are the board's lists. Keyed by list NAME, not id — the
 * inbound handler reports listAfter.name as externalStatus (see inbound.ts),
 * and status mappings are keyed by that name.
 */
export async function fetchTrelloStatuses(params: {
  accessToken: string
  config: Record<string, unknown>
}): Promise<ExternalStatusItem[]> {
  const apiKey = params.config.apiKey as string | undefined
  const boardId = params.config.boardId as string | undefined
  if (!apiKey || !boardId) return []

  try {
    const lists = await listTrelloLists(apiKey, params.accessToken, boardId)
    return lists.map((l) => ({ id: l.name, name: l.name }))
  } catch {
    // Sibling fetchers swallow HTTP failures into an empty list; match them.
    return []
  }
}
