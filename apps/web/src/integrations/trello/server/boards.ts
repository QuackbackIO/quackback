/**
 * Trello board and list listing.
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
    throw new Error(`Failed to list Trello boards: HTTP ${response.status}`)
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
    throw new Error(`Failed to list Trello lists: HTTP ${response.status}`)
  }

  const lists = (await response.json()) as TrelloList[]
  return lists
    .filter((l) => !l.closed)
    .sort((a, b) => a.pos - b.pos)
    .map((l) => ({ id: l.id, name: l.name }))
}
