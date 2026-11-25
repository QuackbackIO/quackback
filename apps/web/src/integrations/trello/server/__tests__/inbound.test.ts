/**
 * Tests for the Trello inbound webhook handler.
 * Signature verification is covered by the shared signature matrix.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/integrations/trello/server/boards', () => ({
  getTrelloCardList: vi.fn(),
}))

import { trelloInboundHandler } from '@/integrations/trello/server/inbound'
import { getTrelloCardList } from '@/integrations/trello/server/boards'

const config = { apiKey: 'test-key', boardId: 'board-1', channelId: 'list-new' }
const secrets = { accessToken: 'test-token' }

/** An `updateCard` delivery for a card moved between lists, trimmed. */
function movePayload(overrides: { data?: object; type?: string; date?: string } = {}) {
  return {
    action: {
      id: 'action-1',
      type: overrides.type ?? 'updateCard',
      date: overrides.date ?? '2026-11-24T13:07:35.977Z',
      data: {
        card: { id: 'card-1', name: 'Dark mode', idList: 'list-done' },
        board: { id: 'board-1', name: 'Roadmap' },
        listBefore: { id: 'list-new', name: 'New' },
        listAfter: { id: 'list-done', name: 'Done' },
        old: { idList: 'list-new' },
        ...overrides.data,
      },
    },
  }
}

function parse(
  payload: unknown,
  cfg: Record<string, unknown> = config,
  sec: Record<string, unknown> = secrets
) {
  return trelloInboundHandler.parseStatusChange(JSON.stringify(payload), cfg, sec)
}

beforeEach(() => {
  vi.mocked(getTrelloCardList).mockReset()
  vi.mocked(getTrelloCardList).mockResolvedValue({ boardId: 'board-1', listName: 'Done' })
})

describe('trelloInboundHandler.parseStatusChange', () => {
  it('declares automatic status handling', () => {
    expect(trelloInboundHandler.statusMode).toBe('automatic')
  })

  it('reads the card back and returns the configured destination', async () => {
    expect(await parse(movePayload())).toEqual({
      externalId: 'card-1',
      externalStatus: 'Done',
      eventType: 'card.moved',
      destinationId: 'list-new',
      occurredAt: '2026-11-24T13:07:35.977Z',
    })
    expect(getTrelloCardList).toHaveBeenCalledWith('test-key', 'test-token', 'card-1')
  })

  it('uses the read-back list name as the status', async () => {
    vi.mocked(getTrelloCardList).mockResolvedValue({ boardId: 'board-1', listName: 'Doing' })
    expect(await parse(movePayload())).toMatchObject({ externalStatus: 'Doing' })
  })

  it('normalizes the action date to ISO 8601', async () => {
    const result = await parse(movePayload({ date: '2026-11-24T13:07:35Z' }))
    expect(result).toMatchObject({ occurredAt: '2026-11-24T13:07:35.000Z' })
  })

  it('returns null when the card is on another board', async () => {
    vi.mocked(getTrelloCardList).mockResolvedValue({ boardId: 'board-2', listName: 'Done' })
    expect(await parse(movePayload())).toBeNull()
  })

  it('returns null when the read-back has no list name', async () => {
    vi.mocked(getTrelloCardList).mockResolvedValue({ boardId: 'board-1', listName: undefined })
    expect(await parse(movePayload())).toBeNull()
  })

  it('returns null for an edit that does not move the card', async () => {
    const payload = movePayload({
      data: { listBefore: undefined, listAfter: undefined, old: { name: 'Old title' } },
    })
    expect(await parse(payload)).toBeNull()
    expect(getTrelloCardList).not.toHaveBeenCalled()
  })

  it('returns null for other action types', async () => {
    expect(await parse(movePayload({ type: 'commentCard' }))).toBeNull()
    expect(getTrelloCardList).not.toHaveBeenCalled()
  })

  it('returns null without a card id', async () => {
    expect(await parse(movePayload({ data: { card: {} } }))).toBeNull()
    expect(getTrelloCardList).not.toHaveBeenCalled()
  })

  it('returns null for a deleted card', async () => {
    vi.mocked(getTrelloCardList).mockRejectedValue(
      Object.assign(new Error('HTTP 404'), { status: 404 })
    )
    expect(await parse(movePayload())).toBeNull()
  })

  it('throws other read-back failures so the receipt is retried', async () => {
    vi.mocked(getTrelloCardList).mockRejectedValue(
      Object.assign(new Error('Rate limited'), { status: 429 })
    )
    await expect(parse(movePayload())).rejects.toThrow('Rate limited')
  })

  it('omits occurredAt when the action date is invalid', async () => {
    const result = await parse(movePayload({ date: 'not a date' }))
    expect(result).toEqual({
      externalId: 'card-1',
      externalStatus: 'Done',
      eventType: 'card.moved',
      destinationId: 'list-new',
      occurredAt: undefined,
    })
  })

  it.each([
    ['board', { apiKey: 'test-key', channelId: 'list-new' }, secrets],
    ['API key', { boardId: 'board-1', channelId: 'list-new' }, secrets],
    ['token', config, {}],
    ['list', { apiKey: 'test-key', boardId: 'board-1' }, secrets],
  ])('falls back to review without a %s', async (_missing, cfg, sec) => {
    expect(await parse(movePayload(), cfg, sec)).toEqual({
      externalId: 'card-1',
      externalStatus: 'Done',
      eventType: 'card.moved',
    })
    expect(getTrelloCardList).not.toHaveBeenCalled()
  })
})
