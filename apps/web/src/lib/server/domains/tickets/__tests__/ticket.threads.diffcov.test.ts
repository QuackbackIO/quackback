/**
 * Differential-coverage tests for ticket.threads — add (audience validation,
 * share-grant guard, body validation, first-response side-effect, sla/notify/
 * dispatch hooks), edit (owner + body guards), soft-delete (already-deleted
 * guard), and the audience-aware list filter.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const m = vi.hoisted(() => ({
  ticketsFindFirst: vi.fn(),
  threadsFindFirst: vi.fn(),
  sharesFindFirst: vi.fn(),
  insertReturning: vi.fn(),
  updateReturning: vi.fn(),
  selectOrderBy: vi.fn(),
  recordEvent: vi.fn(),
  writeActivity: vi.fn(),
  onCustomerReply: vi.fn((..._a: unknown[]) => Promise.resolve()),
  onPublicAgentReply: vi.fn((..._a: unknown[]) => Promise.resolve()),
  notifyThreadAdded: vi.fn((..._a: unknown[]) => Promise.resolve()),
  buildEventActor: vi.fn((..._a: unknown[]) => ({ type: 'user', principalId: 'p1' })),
  dThreadAdded: vi.fn((..._a: unknown[]) => Promise.resolve()),
  dFirstResponse: vi.fn((..._a: unknown[]) => Promise.resolve()),
  dThreadUpdated: vi.fn((..._a: unknown[]) => Promise.resolve()),
  dThreadDeleted: vi.fn((..._a: unknown[]) => Promise.resolve()),
}))

vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      tickets: { findFirst: m.ticketsFindFirst },
      ticketThreads: { findFirst: m.threadsFindFirst },
      ticketShares: { findFirst: m.sharesFindFirst },
    },
    insert: () => ({ values: () => ({ returning: m.insertReturning }) }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: m.updateReturning,
          then: (r: (v: unknown) => void) => r(undefined),
        }),
      }),
    }),
    select: () => ({ from: () => ({ where: () => ({ orderBy: () => m.selectOrderBy() }) }) }),
  },
  eq: vi.fn(),
  and: vi.fn(),
  isNull: vi.fn(),
  asc: vi.fn(),
  inArray: vi.fn(),
  TICKET_THREAD_AUDIENCES: ['public', 'internal', 'shared_team'],
  tickets: { id: 't.id', deletedAt: 't.deletedAt' },
  ticketThreads: {
    id: 'tt.id',
    ticketId: 'tt.ticketId',
    deletedAt: 'tt.deletedAt',
    createdAt: 'tt.createdAt',
  },
  ticketShares: { ticketId: 'ts.ticketId', teamId: 'ts.teamId', revokedAt: 'ts.revokedAt' },
}))

vi.mock('../../audit', () => ({ recordEvent: (...a: unknown[]) => m.recordEvent(...a) }))
vi.mock('@/lib/server/sanitize-tiptap', () => ({ sanitizeTiptapContent: (j: unknown) => j }))
vi.mock('../tiptap-text', () => ({ tiptapToPlainText: () => 'plain text' }))
vi.mock('../ticket.service', () => ({ writeActivity: (...a: unknown[]) => m.writeActivity(...a) }))
vi.mock('../sla/sla.engine', () => ({
  onCustomerReply: (...a: unknown[]) => m.onCustomerReply(...a),
  onPublicAgentReply: (...a: unknown[]) => m.onPublicAgentReply(...a),
}))
vi.mock('../../sla/sla.engine', () => ({
  onCustomerReply: (...a: unknown[]) => m.onCustomerReply(...a),
  onPublicAgentReply: (...a: unknown[]) => m.onPublicAgentReply(...a),
}))
vi.mock('./ticket.notifications', () => ({
  notifyThreadAdded: (...a: unknown[]) => m.notifyThreadAdded(...a),
}))
vi.mock('../ticket.notifications', () => ({
  notifyThreadAdded: (...a: unknown[]) => m.notifyThreadAdded(...a),
}))
vi.mock('@/lib/server/events/dispatch', () => ({
  buildEventActor: (...a: unknown[]) => m.buildEventActor(...a),
  dispatchTicketThreadAdded: (...a: unknown[]) => m.dThreadAdded(...a),
  dispatchTicketFirstResponse: (...a: unknown[]) => m.dFirstResponse(...a),
  dispatchTicketThreadUpdated: (...a: unknown[]) => m.dThreadUpdated(...a),
  dispatchTicketThreadDeleted: (...a: unknown[]) => m.dThreadDeleted(...a),
}))

import {
  addThread,
  editThread,
  softDeleteThread,
  listThreads,
  getThread,
  loadThreadsByTicketIds,
  listPublicThreadsForTicket,
} from '../ticket.threads'

const ticket = (over: Record<string, unknown> = {}) => ({
  id: 'ticket_1',
  deletedAt: null,
  firstResponseAt: null,
  requesterPrincipalId: 'req_p',
  ...over,
})
const thread = (over: Record<string, unknown> = {}) => ({
  id: 'thread_1',
  ticketId: 'ticket_1',
  deletedAt: null,
  principalId: 'p1',
  audience: 'public',
  sharedWithTeamId: null,
  bodyText: 'old',
  bodyJson: null,
  createdAt: new Date('2026-01-01'),
  editedAt: null,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  m.ticketsFindFirst.mockResolvedValue(ticket())
  m.threadsFindFirst.mockResolvedValue(undefined)
  m.sharesFindFirst.mockResolvedValue({ id: 'share_1' })
  m.insertReturning.mockResolvedValue([thread()])
  m.updateReturning.mockResolvedValue([thread()])
  m.selectOrderBy.mockResolvedValue([])
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('addThread validation', () => {
  it('rejects invalid audience and bad shared_team combos', async () => {
    await expect(
      addThread({ ticketId: 't', principalId: 'p1', audience: 'bogus' } as never)
    ).rejects.toThrow('invalid audience')
    await expect(
      addThread({ ticketId: 't', principalId: 'p1', audience: 'shared_team' } as never)
    ).rejects.toThrow('required for shared_team')
    await expect(
      addThread({
        ticketId: 't',
        principalId: 'p1',
        audience: 'public',
        sharedWithTeamId: 'team_1',
      } as never)
    ).rejects.toThrow('only valid for shared_team')
  })
  it('rejects a missing ticket and a missing share grant', async () => {
    m.ticketsFindFirst.mockResolvedValueOnce(undefined)
    await expect(
      addThread({ ticketId: 't', principalId: 'p1', audience: 'public', bodyText: 'hi' } as never)
    ).rejects.toThrow('not found')
    m.sharesFindFirst.mockResolvedValueOnce(undefined)
    await expect(
      addThread({
        ticketId: 't',
        principalId: 'p1',
        audience: 'shared_team',
        sharedWithTeamId: 'team_1',
        bodyText: 'hi',
      } as never)
    ).rejects.toThrow('share grant')
  })
  it('rejects empty and over-long bodies', async () => {
    await expect(
      addThread({
        ticketId: 't',
        principalId: 'p1',
        audience: 'internal',
        bodyText: '   ',
        bodyJson: null,
      } as never)
    ).rejects.toThrow('cannot be empty')
    await expect(
      addThread({
        ticketId: 't',
        principalId: 'p1',
        audience: 'internal',
        bodyText: 'x'.repeat(100_001),
      } as never)
    ).rejects.toThrow('exceeds')
  })
})

describe('addThread success paths', () => {
  it('public agent reply triggers first-response + agent SLA + dispatch', async () => {
    const created = await addThread({
      ticketId: 'ticket_1',
      principalId: 'agent_p',
      audience: 'public',
      bodyText: 'reply',
    } as never)
    expect(created.id).toBe('thread_1')
    expect(m.onPublicAgentReply).toHaveBeenCalled()
    expect(m.dFirstResponse).toHaveBeenCalled()
    expect(m.dThreadAdded).toHaveBeenCalled()
  })
  it('public customer reply triggers the customer SLA hook (no first response)', async () => {
    m.ticketsFindFirst.mockResolvedValueOnce(
      ticket({ requesterPrincipalId: 'req_p', firstResponseAt: new Date() })
    )
    await addThread({
      ticketId: 'ticket_1',
      principalId: 'req_p',
      audience: 'public',
      bodyJson: { type: 'doc' },
    } as never)
    expect(m.onCustomerReply).toHaveBeenCalled()
    expect(m.dFirstResponse).not.toHaveBeenCalled()
  })
  it('internal thread skips SLA hooks but still notifies + dispatches', async () => {
    await addThread({
      ticketId: 'ticket_1',
      principalId: 'agent_p',
      audience: 'internal',
      bodyText: 'note',
    } as never)
    expect(m.onPublicAgentReply).not.toHaveBeenCalled()
    expect(m.notifyThreadAdded).toHaveBeenCalled()
  })
  it('swallows sla / notify / dispatch failures', async () => {
    m.onPublicAgentReply.mockRejectedValueOnce(new Error('sla'))
    m.notifyThreadAdded.mockRejectedValueOnce(new Error('notify'))
    m.dThreadAdded.mockRejectedValueOnce(new Error('dispatch'))
    const created = await addThread({
      ticketId: 'ticket_1',
      principalId: 'agent_p',
      audience: 'public',
      bodyText: 'reply',
    } as never)
    expect(created.id).toBe('thread_1')
    expect(console.warn).toHaveBeenCalled()
  })
})

describe('editThread', () => {
  it('throws when missing/deleted and when not the owner', async () => {
    m.threadsFindFirst.mockResolvedValueOnce(undefined)
    await expect(
      editThread({ threadId: 'thread_1', actorPrincipalId: 'p1' } as never)
    ).rejects.toThrow('not found')
    m.threadsFindFirst.mockResolvedValueOnce(thread({ principalId: 'owner', deletedAt: null }))
    await expect(
      editThread({ threadId: 'thread_1', actorPrincipalId: 'someone-else' } as never)
    ).rejects.toThrow('another user')
  })
  it('rejects an empty edited body', async () => {
    m.threadsFindFirst.mockResolvedValueOnce(thread({ bodyText: '', bodyJson: null }))
    await expect(
      editThread({
        threadId: 'thread_1',
        actorPrincipalId: 'p1',
        bodyText: '  ',
        bodyJson: null,
      } as never)
    ).rejects.toThrow('cannot be empty')
  })
  it('edits and dispatches an update', async () => {
    m.threadsFindFirst.mockResolvedValueOnce(thread())
    m.updateReturning.mockResolvedValueOnce([thread({ editedAt: new Date() })])
    await editThread({ threadId: 'thread_1', actorPrincipalId: 'p1', bodyText: 'new' } as never)
    expect(m.dThreadUpdated).toHaveBeenCalled()
  })
})

describe('softDeleteThread', () => {
  it('throws when missing or already deleted', async () => {
    m.threadsFindFirst.mockResolvedValueOnce(undefined)
    await expect(softDeleteThread('thread_1' as never, 'p1' as never)).rejects.toThrow('not found')
    m.threadsFindFirst.mockResolvedValueOnce(thread({ deletedAt: new Date() }))
    await expect(softDeleteThread('thread_1' as never, 'p1' as never)).rejects.toThrow(
      'already deleted'
    )
  })
  it('soft-deletes and dispatches', async () => {
    m.threadsFindFirst.mockResolvedValueOnce(thread())
    await softDeleteThread('thread_1' as never, 'p1' as never)
    expect(m.dThreadDeleted).toHaveBeenCalled()
  })
})

describe('listThreads + helpers', () => {
  it('filters rows by audience for a viewer', async () => {
    m.selectOrderBy.mockResolvedValueOnce([
      thread({ id: 'a', audience: 'public' }),
      thread({ id: 'b', audience: 'internal' }),
      thread({ id: 'c', audience: 'shared_team', sharedWithTeamId: 'team_1' }),
      thread({ id: 'd', audience: 'shared_team', sharedWithTeamId: null }),
      thread({ id: 'e', audience: 'bogus' }),
    ])
    const res = await listThreads('ticket_1' as never, {
      viewerTeamIds: ['team_1'] as never,
      canSeeInternal: true,
    })
    expect(res.map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })
  it('requester sees public only', async () => {
    m.selectOrderBy.mockResolvedValueOnce([
      thread({ id: 'a', audience: 'public' }),
      thread({ id: 'b', audience: 'internal' }),
    ])
    const res = await listThreads('ticket_1' as never, {
      viewerTeamIds: [],
      canSeeInternal: true,
      isRequester: true,
      includeDeleted: true,
    })
    expect(res.map((r) => r.id)).toEqual(['a'])
  })
  it('getThread returns null when missing', async () => {
    expect(await getThread('thread_1' as never)).toBeNull()
  })
  it('loadThreadsByTicketIds short-circuits on empty', async () => {
    expect(await loadThreadsByTicketIds([])).toEqual([])
    m.selectOrderBy.mockResolvedValueOnce([thread()])
    expect(await loadThreadsByTicketIds(['ticket_1'] as never)).toHaveLength(1)
  })
  it('listPublicThreadsForTicket delegates to public-only', async () => {
    m.selectOrderBy.mockResolvedValueOnce([
      thread({ audience: 'public' }),
      thread({ audience: 'internal' }),
    ])
    expect(await listPublicThreadsForTicket('ticket_1' as never)).toHaveLength(1)
  })
})
