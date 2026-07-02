/**
 * Differential-coverage tests for inbox.channels residuals — listChannelsForInbox,
 * the externalId duplicate guard in addInboxChannel, and the already-archived
 * early return in archiveInboxChannel.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  findFirst: vi.fn(),
  insertReturning: vi.fn(),
  updateReturning: vi.fn(),
  selectRows: vi.fn(),
  dispatch: vi.fn(() => Promise.resolve()),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: { inboxChannels: { findFirst: h.findFirst } },
    insert: () => ({ values: () => ({ returning: () => h.insertReturning() }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: () => h.updateReturning() }) }) }),
    select: () => ({ from: () => ({ where: () => ({ orderBy: () => h.selectRows() }) }) }),
  },
  eq: (...a: unknown[]) => ['eq', ...a],
  and: (...a: unknown[]) => ['and', ...a],
  isNull: (...a: unknown[]) => ['isNull', ...a],
  asc: (...a: unknown[]) => ['asc', ...a],
  inboxChannels: {
    id: 'id',
    inboxId: 'inboxId',
    kind: 'kind',
    externalId: 'externalId',
    archivedAt: 'archivedAt',
    createdAt: 'createdAt',
  },
}))
vi.mock('@/lib/server/events/dispatch', () => ({
  dispatchInboxChannelCreated: h.dispatch,
  dispatchInboxChannelUpdated: h.dispatch,
  dispatchInboxChannelArchived: h.dispatch,
}))
vi.mock('@/lib/shared/utils/date', () => ({
  toIsoStringOrNull: (v: unknown) => (v ? 'iso' : null),
}))

import { addInboxChannel, archiveInboxChannel, listChannelsForInbox } from '../inbox.channels'
import type { InboxId, InboxChannelId } from '@quackback/ids'

const row = (over: Record<string, unknown> = {}) => ({
  id: 'ch_1',
  inboxId: 'inbox_1',
  kind: 'email',
  label: 'L',
  config: {},
  externalId: null,
  enabled: true,
  archivedAt: null,
  ...over,
})

beforeEach(() => vi.clearAllMocks())

describe('listChannelsForInbox', () => {
  it('selects channels for the inbox ordered by creation', async () => {
    h.selectRows.mockResolvedValueOnce([row(), row({ id: 'ch_2' })])
    const res = await listChannelsForInbox('inbox_1' as InboxId)
    expect(res).toHaveLength(2)
  })
})

describe('addInboxChannel externalId guard', () => {
  it('creates a channel with an externalId when there is no duplicate', async () => {
    h.findFirst.mockResolvedValueOnce(undefined)
    h.insertReturning.mockResolvedValueOnce([row({ externalId: 'ext-1' })])
    const created = await addInboxChannel({
      inboxId: 'inbox_1' as InboxId,
      kind: 'email',
      label: 'Support',
      externalId: 'ext-1',
    })
    expect(created.externalId).toBe('ext-1')
  })

  it('rejects a duplicate externalId', async () => {
    h.findFirst.mockResolvedValueOnce(row({ externalId: 'ext-1' }))
    await expect(
      addInboxChannel({
        inboxId: 'inbox_1' as InboxId,
        kind: 'email',
        label: 'Support',
        externalId: 'ext-1',
      })
    ).rejects.toThrow(/already exists/i)
  })
})

describe('archiveInboxChannel', () => {
  it('returns the existing channel unchanged when it is already archived', async () => {
    h.findFirst.mockResolvedValueOnce(row({ archivedAt: new Date('2026-01-01') }))
    const res = await archiveInboxChannel('ch_1' as InboxChannelId)
    expect(res.id).toBe('ch_1')
    expect(h.updateReturning).not.toHaveBeenCalled()
  })
})
