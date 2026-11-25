import { ServiceUnavailableError } from '@/lib/shared/errors'
import { integrationFetch } from '@/lib/server/integrations/sync/transport'
/**
 * Trello board, list and card reads.
 */

const TRELLO_API = 'https://api.trello.com/1'

interface TrelloBoard {
  id: string
  name: string
  closed: boolean
}

interface TrelloList {
  id: string
  name: string
  closed: boolean
  pos: number
}

/**
 * List open boards for the authenticated member.
 */
export async function listTrelloBoards(
  apiKey: string,
  token: string
): Promise<Array<{ id: string; name: string }>> {
  const response = await fetch(
    `${TRELLO_API}/members/me/boards?key=${apiKey}&token=${token}&fields=name,closed&filter=open`
  )

  if (!response.ok) {
    throw new ServiceUnavailableError(
      'PROVIDER_REQUEST_FAILED',
      `Failed to list Trello boards: HTTP ${response.status}`
    )
  }

  const boards = (await response.json()) as TrelloBoard[]
  return boards.filter((b) => !b.closed).map((b) => ({ id: b.id, name: b.name }))
}

/**
 * List open lists in a board.
 */
export async function listTrelloLists(
  apiKey: string,
  token: string,
  boardId: string
): Promise<Array<{ id: string; name: string }>> {
  const response = await fetch(
    `${TRELLO_API}/boards/${boardId}/lists?key=${apiKey}&token=${token}&fields=name,closed,pos&filter=open`
  )

  if (!response.ok) {
    throw new ServiceUnavailableError(
      'PROVIDER_REQUEST_FAILED',
      `Failed to list Trello lists: HTTP ${response.status}`
    )
  }

  const lists = (await response.json()) as TrelloList[]
  return lists
    .filter((l) => !l.closed)
    .sort((a, b) => a.pos - b.pos)
    .map((l) => ({ id: l.id, name: l.name }))
}

export interface TrelloCardList {
  boardId?: string
  listName?: string
}

/**
 * Read a card's current board and list with the stored credentials.
 * Failures carry the HTTP status so callers can tell a deleted card (404) apart.
 */
export async function getTrelloCardList(
  apiKey: string,
  token: string,
  cardId: string
): Promise<TrelloCardList> {
  const params = new URLSearchParams({ fields: 'idBoard,idList', list: 'true', key: apiKey, token })
  const response = await integrationFetch(
    `${TRELLO_API}/cards/${encodeURIComponent(cardId)}?${params}`
  )

  if (!response.ok) {
    throw Object.assign(new Error(`Could not read Trello card: HTTP ${response.status}`), {
      status: response.status,
    })
  }

  const card = (await response.json()) as { idBoard?: unknown; list?: { name?: unknown } }
  return {
    boardId: typeof card.idBoard === 'string' ? card.idBoard : undefined,
    listName: typeof card.list?.name === 'string' ? card.list.name : undefined,
  }
}
