/**
 * Differential-coverage tests for github/event-mappings — ensureGitHubEventMappings
 * sync-direction gate, missing-event computation, and ticket filter derivation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({ findMany: vi.fn(), insertValues: vi.fn() }))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: { integrationEventMappings: { findMany: m.findMany } },
    insert: () => ({ values: (v: unknown) => ({ onConflictDoNothing: () => m.insertValues(v) }) }),
  },
  integrationEventMappings: {
    integrationId: 'iem.integrationId',
    actionType: 'iem.actionType',
    targetKey: 'iem.targetKey',
  },
  eq: vi.fn(),
  and: vi.fn(),
}))

import { ensureGitHubEventMappings } from '../event-mappings'

beforeEach(() => {
  vi.clearAllMocks()
  m.findMany.mockResolvedValue([])
  m.insertValues.mockResolvedValue(undefined)
})

describe('ensureGitHubEventMappings', () => {
  it('returns false for an inbound-only sync direction', async () => {
    expect(
      await ensureGitHubEventMappings({
        integrationId: 'i1' as never,
        config: { syncDirection: 'inbound' },
      })
    ).toBe(false)
    expect(m.findMany).not.toHaveBeenCalled()
  })
  it('inserts missing mappings with a ticket inbox filter (default outbound)', async () => {
    const res = await ensureGitHubEventMappings({
      integrationId: 'i1' as never,
      config: { defaultInboxId: 'inbox_1' },
    })
    expect(res).toBe(true)
    expect(m.insertValues).toHaveBeenCalled()
  })
  it('returns false when all events already exist', async () => {
    m.findMany.mockResolvedValueOnce(
      [
        'ticket.created',
        'ticket.status_changed',
        'ticket.assigned',
        'ticket.updated',
        'ticket.thread_added',
        'ticket.thread_updated',
        'ticket.thread_deleted',
        'ticket.attachment_added',
        'ticket.attachment_removed',
        'post.created',
      ].map((eventType) => ({ eventType }))
    )
    expect(
      await ensureGitHubEventMappings({
        integrationId: 'i1' as never,
        config: { syncDirection: 'bidirectional' },
      })
    ).toBe(false)
    expect(m.insertValues).not.toHaveBeenCalled()
  })
  it('handles a null config (defaults to outbound, no inbox filter)', async () => {
    expect(await ensureGitHubEventMappings({ integrationId: 'i1' as never, config: null })).toBe(
      true
    )
  })
})
