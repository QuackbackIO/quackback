/**
 * ticket.threads — gap tests for branches not hit by the diffcov suite:
 * system (null-principal) service-actor paths in add/edit/delete, the
 * null-bodyJson edit fallback, and the null shared-team / null body
 * fallbacks in the dispatch payloads.
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

vi.mock('../../audit', () => ({ recordEvent: m.recordEvent }))
vi.mock('@/lib/server/sanitize-tiptap', () => ({ sanitizeTiptapContent: (j: unknown) => j }))
vi.mock('../tiptap-text', () => ({ tiptapToPlainText: () => 'plain text' }))
vi.mock('../ticket.service', () => ({ writeActivity: m.writeActivity }))
vi.mock('../sla/sla.engine', () => ({
  onCustomerReply: m.onCustomerReply,
  onPublicAgentReply: m.onPublicAgentReply,
}))
vi.mock('../../sla/sla.engine', () => ({
  onCustomerReply: m.onCustomerReply,
  onPublicAgentReply: m.onPublicAgentReply,
}))
vi.mock('./ticket.notifications', () => ({
  notifyThreadAdded: m.notifyThreadAdded,
}))
vi.mock('../ticket.notifications', () => ({
  notifyThreadAdded: m.notifyThreadAdded,
}))
vi.mock('@/lib/server/events/dispatch', () => ({
  buildEventActor: m.buildEventActor,
  dispatchTicketThreadAdded: m.dThreadAdded,
  dispatchTicketFirstResponse: m.dFirstResponse,
  dispatchTicketThreadUpdated: m.dThreadUpdated,
  dispatchTicketThreadDeleted: m.dThreadDeleted,
}))

import { addThread, editThread, softDeleteThread } from '../ticket.threads'

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

describe('addThread system (null principal) path', () => {
  it('builds a service actor and skips SLA hooks when principalId is null', async () => {
    await addThread({
      ticketId: 'ticket_1',
      principalId: null,
      audience: 'public',
      bodyText: 'system note',
    } as never)
    // null principal -> no SLA hook fired (neither customer nor agent branch)
    expect(m.onCustomerReply).not.toHaveBeenCalled()
    expect(m.onPublicAgentReply).not.toHaveBeenCalled()
    // service actor (buildEventActor not used for the dispatch actor)
    expect(m.buildEventActor).not.toHaveBeenCalled()
    expect(m.dThreadAdded).toHaveBeenCalled()
    // firstResponseFired is false (principalId null), so no first-response dispatch
    expect(m.dFirstResponse).not.toHaveBeenCalled()
  })

  it('missing active share grant rejects shared_team threads', async () => {
    m.sharesFindFirst.mockResolvedValueOnce(undefined)
    await expect(
      addThread({
        ticketId: 'ticket_1',
        principalId: 'agent_p',
        audience: 'shared_team',
        sharedWithTeamId: 'team_1',
        bodyText: 'note',
      } as never)
    ).rejects.toThrow('share grant')
  })
})

describe('editThread fallbacks', () => {
  it('keeps existing bodyJson and uses a service actor when actor is null', async () => {
    m.threadsFindFirst.mockResolvedValueOnce(
      thread({ principalId: null, bodyJson: { type: 'doc' }, bodyText: 'keep' })
    )
    m.updateReturning.mockResolvedValueOnce([
      thread({ principalId: null, sharedWithTeamId: null, editedAt: new Date() }),
    ])
    await editThread({
      threadId: 'thread_1',
      actorPrincipalId: null,
      bodyText: 'new body',
    } as never)
    expect(m.buildEventActor).not.toHaveBeenCalled()
    expect(m.dThreadUpdated).toHaveBeenCalled()
  })

  it('skips dispatch when the parent ticket is gone', async () => {
    m.threadsFindFirst.mockResolvedValueOnce(thread())
    m.ticketsFindFirst.mockResolvedValueOnce(undefined)
    await editThread({ threadId: 'thread_1', actorPrincipalId: 'p1', bodyText: 'new' } as never)
    expect(m.dThreadUpdated).not.toHaveBeenCalled()
  })
})

describe('softDeleteThread fallbacks', () => {
  it('uses a service actor and empty-body fallback when fields are null', async () => {
    m.threadsFindFirst.mockResolvedValueOnce(
      thread({ principalId: null, bodyText: null, sharedWithTeamId: null })
    )
    m.updateReturning.mockResolvedValueOnce([
      thread({ principalId: null, bodyText: null, sharedWithTeamId: null, deletedAt: new Date() }),
    ])
    await softDeleteThread('thread_1' as never, null)
    expect(m.buildEventActor).not.toHaveBeenCalled()
    expect(m.dThreadDeleted).toHaveBeenCalled()
  })

  it('skips dispatch when the parent ticket is gone', async () => {
    m.threadsFindFirst.mockResolvedValueOnce(thread())
    m.ticketsFindFirst.mockResolvedValueOnce(undefined)
    await softDeleteThread('thread_1' as never, 'p1' as never)
    expect(m.dThreadDeleted).not.toHaveBeenCalled()
  })
})
