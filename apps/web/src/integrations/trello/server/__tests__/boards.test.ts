import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/server/integrations/sync/transport', () => ({
  integrationFetch: vi.fn(),
}))

import { getTrelloCardList } from '@/integrations/trello/server/boards'
import { integrationFetch } from '@/lib/server/integrations/sync/transport'

beforeEach(() => {
  vi.mocked(integrationFetch).mockReset()
})

describe('getTrelloCardList', () => {
  it('reads the card board and nested list with the stored credentials', async () => {
    vi.mocked(integrationFetch).mockResolvedValue(
      Response.json({
        id: 'card-1',
        idBoard: 'board-1',
        idList: 'list-1',
        list: { id: 'list-1', name: 'Done' },
      })
    )
    expect(await getTrelloCardList('key', 'token', 'card-1')).toEqual({
      boardId: 'board-1',
      listName: 'Done',
    })
    const url = new URL(String(vi.mocked(integrationFetch).mock.calls[0][0]))
    expect(url.pathname).toBe('/1/cards/card-1')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      fields: 'idBoard,idList',
      list: 'true',
      key: 'key',
      token: 'token',
    })
  })

  it('throws with the HTTP status on failure', async () => {
    vi.mocked(integrationFetch).mockResolvedValue(new Response('not found', { status: 404 }))
    await expect(getTrelloCardList('key', 'token', 'card-1')).rejects.toMatchObject({
      status: 404,
    })
  })
})
