/**
 * Shared entity options for the fullscreen workflow builder (support platform
 * §4.6): teammates, teams, tags, live SLA policies, and live attribute
 * definitions, plus the id -> display name lookups the canvas card summaries
 * and outline rows need. One provider so the canvas, outline, and inspector
 * all read the same cached queries instead of each firing their own.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTeamMembers } from '@/lib/client/hooks/use-team-members'
import { useInboxTeams } from '@/components/admin/conversation/inbox-nav-sidebar'
import { fetchConversationTagsFn } from '@/lib/server/functions/conversation-tags'
import { listSlaPolicyOptionsFn, type SlaPolicyOption } from '@/lib/server/functions/sla'
import { ticketQueries } from '@/lib/client/queries/inbox'
import {
  conversationAttributeQueries,
  type ConversationAttributeItem,
} from '@/lib/client/queries/conversation-attributes'
import { useUserAttributes } from '@/lib/client/hooks/use-user-attributes-queries'
import { useCompanyAttributes } from '@/lib/client/hooks/use-company-attributes-queries'
import {
  toAttributeFieldDefs,
  toPersonCompanyAttributeFieldDefs,
  type EntityLabels,
  type PersonCompanyAttributeFieldDef,
} from '../workflow-graph'

export interface EntityOption {
  id: string
  name: string
}

export interface WorkflowEntities {
  members: EntityOption[]
  teams: EntityOption[]
  tags: EntityOption[]
  /** Live SLA policies for the Apply-SLA picker, with their targets line. */
  slaPolicies: SlaPolicyOption[]
  /** The workspace's ticket status catalogue, read-only, for the
   *  set_ticket_status action's picker (support platform's ticket-actions
   *  extension) — reuses the same query the ticket workspace's own status
   *  picker reads (lib/client/queries/inbox.ts's ticketQueries.statuses). */
  ticketStatuses: EntityOption[]
  /** Live attribute definitions (full shape: the value editor needs field
   *  type + options, not just id/name). */
  attributes: ConversationAttributeItem[]
  /** Live user/company attribute definitions, for the person.attr.* /
   *  company.attr.* condition field groups — same role as `attributes`
   *  above, one array per registry (they're independently keyed stores). */
  personAttributes: PersonCompanyAttributeFieldDef[]
  companyAttributes: PersonCompanyAttributeFieldDef[]
  labels: EntityLabels
}

const WorkflowEntitiesContext = createContext<WorkflowEntities | null>(null)

export function useWorkflowEntities(): WorkflowEntities {
  const ctx = useContext(WorkflowEntitiesContext)
  if (!ctx) throw new Error('useWorkflowEntities must be used inside WorkflowEntitiesProvider')
  return ctx
}

const toMap = (items: EntityOption[]) => new Map(items.map((i) => [i.id, i.name]))

export function WorkflowEntitiesProvider({ children }: { children: ReactNode }) {
  const { data: members } = useTeamMembers()
  const { data: teams } = useInboxTeams()
  const { data: tags } = useQuery({
    queryKey: ['admin', 'conversation-tags', 'all'],
    queryFn: () => fetchConversationTagsFn(),
    staleTime: 60_000,
  })
  const { data: slaPolicies } = useQuery({
    queryKey: ['admin', 'sla-policy-options'],
    queryFn: () => listSlaPolicyOptionsFn(),
    staleTime: 60_000,
  })
  const { data: ticketStatuses } = useQuery(ticketQueries.statuses())
  const { data: attributes } = useQuery(conversationAttributeQueries.live())
  // Gated per their own domain's view permission (USER_ATTRIBUTE_VIEW /
  // COMPANY_VIEW respectively — see listUserAttributesFn/listCompanyAttributesFn),
  // same as conversationAttributeQueries.live() above is gated CONVERSATION_VIEW:
  // each attribute-field group stays behind the read gate its own registry
  // already uses everywhere else, so a builder viewer with no company/user-
  // attribute access simply sees that group stay empty rather than erroring.
  const { data: personAttributeDefs } = useUserAttributes()
  const { data: companyAttributeDefs } = useCompanyAttributes()
  const value = useMemo<WorkflowEntities>(() => {
    const memberOptions = (members ?? []).map((m) => ({ id: m.id, name: m.name ?? 'Unnamed' }))
    const teamOptions = (teams ?? []).map((t) => ({ id: t.id, name: t.name }))
    const tagOptions = (tags ?? []).map((t) => ({ id: t.id, name: t.name }))
    const slaOptions = slaPolicies ?? []
    const ticketStatusOptions = (ticketStatuses ?? []).map((s) => ({ id: s.id, name: s.name }))
    return {
      members: memberOptions,
      teams: teamOptions,
      tags: tagOptions,
      slaPolicies: slaOptions,
      ticketStatuses: ticketStatusOptions,
      attributes: attributes ?? [],
      personAttributes: personAttributeDefs ?? [],
      companyAttributes: companyAttributeDefs ?? [],
      labels: {
        members: toMap(memberOptions),
        teams: toMap(teamOptions),
        tags: toMap(tagOptions),
        slaPolicies: toMap(slaOptions),
        attributes: toAttributeFieldDefs(attributes ?? []),
        personAttributes: toPersonCompanyAttributeFieldDefs(personAttributeDefs ?? []),
        companyAttributes: toPersonCompanyAttributeFieldDefs(companyAttributeDefs ?? []),
        ticketStatuses: toMap(ticketStatusOptions),
      },
    }
  }, [
    members,
    teams,
    tags,
    slaPolicies,
    ticketStatuses,
    attributes,
    personAttributeDefs,
    companyAttributeDefs,
  ])

  return (
    <WorkflowEntitiesContext.Provider value={value}>{children}</WorkflowEntitiesContext.Provider>
  )
}
