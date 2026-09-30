/**
 * The agent thread request loads the reads beside the conversation that its
 * caller asks for. Pins that only requested panels are read, that each keeps
 * the permission its own server function requires, that each comes back in
 * that function's shape (the client seeds those queries with it), and that a
 * failing read leaves its panel out rather than failing the thread.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ConversationId, PrincipalId, TicketId, UserId } from '@quackback/ids'
import type { Conversation } from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { AGENT_CONVERSATION_PANELS } from '@/lib/shared/conversation/agent-panels'

const mocks = vi.hoisted(() => ({
  getLinkedCustomerTicket: vi.fn(),
  getTicket: vi.fn(),
  getBlockStatus: vi.fn(),
  getPortalUserDetail: vi.fn(),
  listConversationsForAgent: vi.fn(),
  getForPrincipal: vi.fn(),
  getLatestInvolvement: vi.fn(),
  findUser: vi.fn(),
  listMacros: vi.fn(),
  listWorkflows: vi.fn(),
  listTeamMembers: vi.fn(),
  getStageLabels: vi.fn(),
}))

vi.mock('@/lib/server/domains/inbox/inbox.query', () => ({
  getLinkedCustomerTicket: mocks.getLinkedCustomerTicket,
}))
vi.mock('@/lib/server/domains/tickets/ticket.service', () => ({ getTicket: mocks.getTicket }))
vi.mock('@/lib/server/domains/principals/blocking', () => ({
  getBlockStatus: mocks.getBlockStatus,
}))
vi.mock('@/lib/server/domains/users/user.detail', () => ({
  getPortalUserDetail: mocks.getPortalUserDetail,
}))
vi.mock('@/lib/server/domains/conversation/conversation.query', () => ({
  listConversationsForAgent: mocks.listConversationsForAgent,
}))
vi.mock('@/lib/server/domains/companies/company.service', () => ({
  getForPrincipal: mocks.getForPrincipal,
}))
vi.mock('@/lib/server/domains/assistant/assistant.involvement', () => ({
  getLatestInvolvement: mocks.getLatestInvolvement,
}))
vi.mock('@/lib/server/db', () => ({
  db: { query: { user: { findFirst: mocks.findUser } } },
  eq: (a: unknown, b: unknown) => ({ a, b }),
  user: { id: 'user.id' },
}))
vi.mock('@/lib/server/domains/macros/macro.service', () => ({ listMacros: mocks.listMacros }))
vi.mock('@/lib/server/domains/workflows/workflow.service', () => ({
  listWorkflows: mocks.listWorkflows,
}))
vi.mock('@/lib/server/domains/principals/principal.service', () => ({
  listTeamMembers: mocks.listTeamMembers,
}))
vi.mock('@/lib/server/domains/settings/settings.tickets', () => ({
  getStageLabels: mocks.getStageLabels,
}))
vi.mock('../companies', () => ({
  serializeCompany: (c: { id: string; name: string }) => ({ id: c.id, name: c.name }),
}))
vi.mock('../admin', () => ({
  serializePortalUserDetail: (d: { principalId: string }) => ({ ...d, serialized: true }),
}))
vi.mock('../workflows', () => ({
  toRunnableWorkflows: (all: { id: string; status: string }[]) =>
    all.filter((w) => w.status === 'live').map((w) => ({ id: w.id })),
}))
vi.mock('@/lib/server/logger', () => ({
  logger: { child: () => ({ debug: vi.fn(), error: vi.fn(), warn: vi.fn(), info: vi.fn() }) },
}))

const { loadAgentConversationPanels, loadConversationAssistantActivity } =
  await import('../conversation-panels')

const CONVERSATION = 'conversation_01h00000000000000000000000' as ConversationId
const VISITOR = 'principal_01h00000000000000000000000' as PrincipalId
const TICKET = 'ticket_01h00000000000000000000000' as TicketId
const conversation = { id: CONVERSATION, visitorPrincipalId: VISITOR } as Conversation
const actor = { principalId: 'principal_agent' } as unknown as Actor
const ALL_PERMISSIONS: PermissionKey[] = [
  PERMISSIONS.CONVERSATION_VIEW,
  PERMISSIONS.CONVERSATION_REPLY,
  PERMISSIONS.TICKET_VIEW,
  PERMISSIONS.PEOPLE_VIEW,
  PERMISSIONS.COMPANY_VIEW,
  PERMISSIONS.MEMBER_VIEW,
]
const caller = (permissions: PermissionKey[] = ALL_PERMISSIONS) => ({
  userId: 'user_agent' as UserId,
  permissions,
  actor,
})

const LINK = { id: TICKET, number: 7, title: 'Broken', statusName: 'Open', statusCategory: 'open' }

beforeEach(() => {
  vi.resetAllMocks()
  mocks.getLinkedCustomerTicket.mockResolvedValue(LINK)
  mocks.getTicket.mockResolvedValue({ id: TICKET, title: 'Broken' })
  mocks.getBlockStatus.mockResolvedValue({ blockedAt: null })
  mocks.getPortalUserDetail.mockResolvedValue({ principalId: VISITOR })
  mocks.listConversationsForAgent.mockResolvedValue({
    conversations: [],
    hasMore: false,
    nextCursor: null,
  })
  mocks.getForPrincipal.mockResolvedValue({ id: 'company_1', name: 'Acme', extra: 'x' })
  mocks.getLatestInvolvement.mockResolvedValue(null)
  mocks.findUser.mockResolvedValue({ preferredLanguage: 'fr' })
  mocks.listMacros.mockResolvedValue([{ id: 'macro_1' }])
  mocks.listWorkflows.mockResolvedValue([
    { id: 'wf_live', status: 'live' },
    { id: 'wf_draft', status: 'draft' },
  ])
  mocks.listTeamMembers.mockResolvedValue([{ id: 'principal_a' }])
  mocks.getStageLabels.mockResolvedValue({ received: 'Received' })
})

describe('loadAgentConversationPanels', () => {
  it('reads nothing when nothing is asked for', async () => {
    expect(await loadAgentConversationPanels(conversation, [], caller())).toEqual({})
    for (const fn of Object.values(mocks)) expect(fn).not.toHaveBeenCalled()
  })

  it('reads only the panels asked for', async () => {
    const panels = await loadAgentConversationPanels(conversation, ['blockStatus'], caller())

    expect(panels).toEqual({ blockStatus: { blockedAt: null } })
    expect(mocks.getBlockStatus).toHaveBeenCalledWith(VISITOR)
    expect(mocks.getPortalUserDetail).not.toHaveBeenCalled()
    expect(mocks.listTeamMembers).not.toHaveBeenCalled()
  })

  it('answers every panel in the shape its own server function returns', async () => {
    const panels = await loadAgentConversationPanels(
      conversation,
      AGENT_CONVERSATION_PANELS,
      caller()
    )

    expect(panels).toEqual({
      ticketLink: LINK,
      linkedTicket: { id: TICKET, title: 'Broken' },
      blockStatus: { blockedAt: null },
      contact: { principalId: VISITOR, serialized: true },
      history: { conversations: [], hasMore: false, nextCursor: null },
      company: { id: 'company_1', name: 'Acme' },
      assistantActivity: null,
      languagePreference: 'fr',
      macros: { macros: [{ id: 'macro_1' }] },
      runnableWorkflows: [{ id: 'wf_live' }],
      teamMembers: [{ id: 'principal_a' }],
      ticketStageLabels: { received: 'Received' },
    })
    expect(mocks.listConversationsForAgent).toHaveBeenCalledWith(
      { visitorPrincipalId: VISITOR },
      actor
    )
    expect(mocks.getTicket).toHaveBeenCalledWith(TICKET)
    expect(mocks.listMacros).toHaveBeenCalledWith('support')
    // The link is read once for every ticket panel.
    expect(mocks.getLinkedCustomerTicket).toHaveBeenCalledTimes(1)
  })

  it('keeps null answers, which are answers, and seeds no ticket reads without a link', async () => {
    mocks.getLinkedCustomerTicket.mockResolvedValue(null)
    mocks.getPortalUserDetail.mockResolvedValue(null)
    mocks.getForPrincipal.mockResolvedValue(null)
    mocks.findUser.mockResolvedValue({ preferredLanguage: null })

    const panels = await loadAgentConversationPanels(
      conversation,
      [
        'ticketLink',
        'linkedTicket',
        'ticketStageLabels',
        'contact',
        'company',
        'languagePreference',
      ],
      caller()
    )

    expect(panels).toEqual({
      ticketLink: null,
      contact: null,
      company: null,
      languagePreference: null,
    })
    expect(mocks.getTicket).not.toHaveBeenCalled()
    expect(mocks.getStageLabels).not.toHaveBeenCalled()
  })

  it.each([
    ['linkedTicket', PERMISSIONS.TICKET_VIEW, mocks.getTicket],
    ['ticketStageLabels', PERMISSIONS.TICKET_VIEW, mocks.getStageLabels],
    ['blockStatus', PERMISSIONS.PEOPLE_VIEW, mocks.getBlockStatus],
    ['contact', PERMISSIONS.PEOPLE_VIEW, mocks.getPortalUserDetail],
    ['company', PERMISSIONS.COMPANY_VIEW, mocks.getForPrincipal],
    ['macros', PERMISSIONS.CONVERSATION_REPLY, mocks.listMacros],
    ['runnableWorkflows', PERMISSIONS.CONVERSATION_REPLY, mocks.listWorkflows],
    ['teamMembers', PERMISSIONS.MEMBER_VIEW, mocks.listTeamMembers],
  ] as const)('leaves %s out without %s', async (panel, permission, read) => {
    const without = ALL_PERMISSIONS.filter((p) => p !== permission)

    const panels = await loadAgentConversationPanels(conversation, [panel], caller(without))

    expect(panels).toEqual({})
    expect(read).not.toHaveBeenCalled()
  })

  it('leaves a panel whose read fails out and still answers the rest', async () => {
    mocks.getPortalUserDetail.mockRejectedValue(new Error('boom'))

    const panels = await loadAgentConversationPanels(
      conversation,
      ['contact', 'blockStatus'],
      caller()
    )

    expect(panels).toEqual({ blockStatus: { blockedAt: null } })
  })
})

describe('loadConversationAssistantActivity', () => {
  it("maps Quinn's latest involvement for the panel", async () => {
    mocks.getLatestInvolvement.mockResolvedValue({
      status: 'handed_off',
      handoffReason: 'asked_for_human',
      sources: [{ type: 'article', id: 'a1', title: null, url: null }],
      rating: 4,
      lastAssistantAnswerAt: new Date('2026-07-01T00:00:00.000Z'),
    })

    expect(await loadConversationAssistantActivity(CONVERSATION)).toEqual({
      outcome: 'handed_off',
      handoffReason: 'asked_for_human',
      sources: [{ type: 'article', id: 'a1', title: '', url: '' }],
      rating: 4,
      answeredAt: '2026-07-01T00:00:00.000Z',
    })
  })
})
