/**
 * Input + DTO shapes for the ticket domain (support platform §4.2). The DTO
 * types are the contract the admin ticket UI codes against; they carry only
 * plain JSON (ISO strings, resolved display names) so a client can import them
 * type-only with no server dependency.
 */
import type { TicketId, TicketStatusId, PrincipalId, TeamId, CompanyId } from '@quackback/ids'
import type {
  TicketType,
  TicketStage,
  TicketStatusCategory,
  ConversationPriority,
} from '@/lib/shared/db-types'
import type { ConversationAuthorDTO } from '@/lib/shared/conversation/types'

// ---------------------------------------------------------------------------
// Service inputs
// ---------------------------------------------------------------------------

/** Fields accepted when opening a ticket. Status + number are resolved server-side. */
export interface CreateTicketInput {
  type: TicketType
  title: string
  requesterPrincipalId?: PrincipalId | null
  priority?: ConversationPriority
  companyId?: CompanyId | null
  customAttributes?: Record<string, unknown>
}

/** Polymorphic, independent assignment: an absent key leaves that side as-is. */
export interface AssignTicketInput {
  assigneePrincipalId?: PrincipalId | null
  assigneeTeamId?: TeamId | null
}

/** How a ticket list is ordered. `recent`/`oldest` sort by activity (updatedAt). */
export type TicketSort = 'recent' | 'oldest' | 'created' | 'priority'

/** Who a list is scoped to by assignee: the caller, nobody, or a specific teammate. */
export type TicketAssigneeFilter = 'me' | 'unassigned' | PrincipalId

/** List query filters. All optional; omitted filters do not constrain the result. */
export interface TicketListFilter {
  type?: TicketType
  statusCategory?: TicketStatusCategory
  stage?: TicketStage
  assignee?: TicketAssigneeFilter
  teamId?: TeamId
  requesterPrincipalId?: PrincipalId
  companyId?: CompanyId
  sort?: TicketSort
  limit?: number
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

/**
 * A resolved principal reference (requester / assignee). Structurally the inbox
 * author, so it aliases ConversationAuthorDTO — the DTO builder reuses the inbox
 * loader (loadAuthors), which produces exactly this shape.
 */
export type TicketPrincipalRef = ConversationAuthorDTO

/** The ticket's status, flattened for display. */
export interface TicketStatusRef {
  id: TicketStatusId
  name: string
  color: string
  category: TicketStatusCategory
}

/**
 * The requester-facing stage the status projects to. `slot` is null and `label`
 * is null when the status is hidden from the requester (internal-only).
 */
export interface TicketStageRef {
  slot: TicketStage | null
  label: string | null
}

/** Polymorphic assignee: a teammate, a team, both, or neither. */
export interface TicketAssigneeRef {
  principalId: PrincipalId | null
  displayName: string | null
  teamId: TeamId | null
  teamName: string | null
}

/** The B2B company context shown inline on a ticket. */
export interface TicketCompanyRef {
  id: CompanyId
  name: string
}

/** The wire shape for a ticket. `number` is the raw sequence; `reference` is it rendered. */
export interface TicketDTO {
  id: TicketId
  number: number
  reference: string
  type: TicketType
  title: string
  status: TicketStatusRef
  stage: TicketStageRef
  priority: ConversationPriority
  requester: TicketPrincipalRef | null
  assignee: TicketAssigneeRef
  company: TicketCompanyRef | null
  firstResponseAt: string | null
  dueAt: string | null
  resolvedAt: string | null
  createdAt: string
  updatedAt: string
  reopenedCount: number
}
