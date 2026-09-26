/**
 * Loads the reads beside an open conversation (see
 * lib/shared/conversation/agent-panels.ts) for the agent thread request, each
 * in the shape its own server function returns so the client can seed that
 * function's query with it.
 *
 * Every panel keeps the permission its own function requires; a panel the
 * caller may not read is left out, and its query then asks on its own and is
 * refused as before. A panel whose read fails is left out the same way, so it
 * never fails the thread.
 */
import type { ConversationId, PrincipalId, UserId } from '@quackback/ids'
import type { Conversation } from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import type { TicketDTO } from '@/lib/server/domains/tickets'
import type { MacroDTO } from '@/lib/server/domains/macros/macro.service'
import type { TeamMember } from '@/lib/server/domains/principals/principal.types'
import type { ConversationListPage } from '@/lib/server/domains/conversation/conversation.query'
import type { ConversationAssistantActivity } from '@/lib/shared/conversation/types'
import type { LinkedTicketSummary } from '@/lib/shared/inbox/items'
import type { TicketStageLabels } from '@/lib/shared/tickets'
import type { AgentConversationPanel } from '@/lib/shared/conversation/agent-panels'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { logger } from '@/lib/server/logger'
import type { CompanyDTO } from './companies'
import type { PortalUserDetailDTO } from './admin'
import type { RunnableWorkflowDTO } from './workflows'

const log = logger.child({ component: 'conversation-panels' })

export interface AgentConversationPanels {
  ticketLink?: LinkedTicketSummary | null
  linkedTicket?: TicketDTO
  ticketStageLabels?: TicketStageLabels
  blockStatus?: { blockedAt: string | null }
  contact?: PortalUserDetailDTO | null
  history?: ConversationListPage
  company?: CompanyDTO | null
  assistantActivity?: ConversationAssistantActivity | null
  languagePreference?: string | null
  macros?: { macros: MacroDTO[] }
  runnableWorkflows?: RunnableWorkflowDTO[]
  teamMembers?: TeamMember[]
}

/** Quinn's latest involvement in a conversation, as `getConversationAssistantActivityFn` returns it. */
export async function loadConversationAssistantActivity(
  conversationId: ConversationId
): Promise<ConversationAssistantActivity | null> {
  const { getLatestInvolvement } =
    await import('@/lib/server/domains/assistant/assistant.involvement')
  const inv = await getLatestInvolvement(conversationId)
  if (!inv) return null
  return {
    outcome: inv.status,
    handoffReason: inv.handoffReason,
    sources: inv.sources.map((s) => ({
      type: s.type,
      id: s.id,
      title: s.title ?? '',
      url: s.url ?? '',
    })),
    rating: inv.rating,
    answeredAt: inv.lastAssistantAnswerAt?.toISOString() ?? null,
  }
}

/** The permission each panel's own server function requires beyond conversation.view. */
const PANEL_PERMISSION: Partial<Record<AgentConversationPanel, PermissionKey>> = {
  linkedTicket: PERMISSIONS.TICKET_VIEW,
  ticketStageLabels: PERMISSIONS.TICKET_VIEW,
  blockStatus: PERMISSIONS.PEOPLE_VIEW,
  contact: PERMISSIONS.PEOPLE_VIEW,
  company: PERMISSIONS.COMPANY_VIEW,
  macros: PERMISSIONS.CONVERSATION_REPLY,
  runnableWorkflows: PERMISSIONS.CONVERSATION_REPLY,
  teamMembers: PERMISSIONS.MEMBER_VIEW,
}

type PanelLoaders = {
  [P in AgentConversationPanel]: () => Promise<NonNullable<AgentConversationPanels[P]> | null>
}

/**
 * Load the requested panels for a conversation the caller may already view
 * as an agent (the thread request has checked conversation.view and the
 * conversation's visibility to this actor).
 */
export async function loadAgentConversationPanels(
  conversation: Conversation,
  requested: readonly AgentConversationPanel[],
  caller: { userId: UserId; permissions: readonly PermissionKey[]; actor: Actor }
): Promise<AgentConversationPanels> {
  const visitor = conversation.visitorPrincipalId as PrincipalId
  const wanted = requested.filter((panel) => {
    const permission = PANEL_PERMISSION[panel]
    return !permission || caller.permissions.includes(permission)
  })
  if (wanted.length === 0) return {}

  // The linked ticket's id comes from the link, which either panel needs.
  let link: Promise<LinkedTicketSummary | null> | undefined
  const readLink = () =>
    (link ??= import('@/lib/server/domains/inbox/inbox.query').then((m) =>
      m.getLinkedCustomerTicket(conversation.id)
    ))

  const loaders: PanelLoaders = {
    ticketLink: readLink,
    linkedTicket: async () => {
      const summary = await readLink()
      if (!summary) return null
      const { getTicket } = await import('@/lib/server/domains/tickets/ticket.service')
      return getTicket(summary.id)
    },
    ticketStageLabels: async () => {
      if (!(await readLink())) return null
      const { getStageLabels } = await import('@/lib/server/domains/settings/settings.tickets')
      return getStageLabels()
    },
    blockStatus: async () => {
      const { getBlockStatus } = await import('@/lib/server/domains/principals/blocking')
      return getBlockStatus(visitor)
    },
    contact: async () => {
      const [{ getPortalUserDetail }, { serializePortalUserDetail }] = await Promise.all([
        import('@/lib/server/domains/users/user.detail'),
        import('./admin'),
      ])
      const detail = await getPortalUserDetail(visitor)
      return detail ? serializePortalUserDetail(detail) : null
    },
    history: async () => {
      const { listConversationsForAgent } =
        await import('@/lib/server/domains/conversation/conversation.query')
      return listConversationsForAgent({ visitorPrincipalId: visitor }, caller.actor)
    },
    company: async () => {
      const [{ getForPrincipal }, { serializeCompany }] = await Promise.all([
        import('@/lib/server/domains/companies/company.service'),
        import('./companies'),
      ])
      const company = await getForPrincipal(visitor)
      return company ? serializeCompany(company) : null
    },
    assistantActivity: () => loadConversationAssistantActivity(conversation.id),
    languagePreference: async () => {
      const { readPreferredLanguage } = await import('./teammate-preferences')
      return readPreferredLanguage(caller.userId)
    },
    macros: async () => {
      const { listMacros } = await import('@/lib/server/domains/macros/macro.service')
      return { macros: await listMacros('support') }
    },
    runnableWorkflows: async () => {
      const [{ listWorkflows }, { toRunnableWorkflows }] = await Promise.all([
        import('@/lib/server/domains/workflows/workflow.service'),
        import('./workflows'),
      ])
      return toRunnableWorkflows(await listWorkflows())
    },
    teamMembers: async () => {
      const { listTeamMembers } = await import('@/lib/server/domains/principals/principal.service')
      return listTeamMembers()
    },
  }

  const loaded = await Promise.all(
    wanted.map(async (panel) => {
      try {
        return [panel, await loaders[panel]()] as const
      } catch (err) {
        log.warn(
          { err, conversation_id: conversation.id, panel },
          'conversation panel read failed; its own request will retry it'
        )
        return [panel, undefined] as const
      }
    })
  )

  const panels: Record<string, unknown> = {}
  for (const [panel, value] of loaded) {
    // null is an answer (no link, no company, no preference); undefined is not.
    // A ticket read with no linked ticket has nothing to seed.
    if (value === undefined) continue
    if ((panel === 'linkedTicket' || panel === 'ticketStageLabels') && value === null) continue
    panels[panel] = value
  }
  return panels as AgentConversationPanels
}
