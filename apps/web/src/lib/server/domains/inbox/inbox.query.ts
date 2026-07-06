/**
 * Unified inbox union query (UNIFIED-INBOX-SPEC.md §3.1): merges the
 * conversation and ticket branches into one activity-ordered feed.
 *
 * Two independently keyset-paginated branches (`listConversationsForAgent`,
 * `listTickets`) are fetched in parallel, each already scoped by its own RBAC
 * predicate (`conversationFilter`/`ticketFilter`), then merge-sorted here in
 * TS. A branch the actor cannot view at all (neither `view` nor `view_all`)
 * or that the caller excluded via `filter.kinds` is skipped outright rather
 * than run as a guaranteed-empty query.
 *
 * CURSOR CONTRACT (a documented deviation from the spec's literal
 * `{ activityAt, kind, id }` triple): the opaque cursor instead carries EACH
 * branch's own native keyset cursor forward — `{ c: ConversationId | null, t:
 * TicketId | null }` — rather than a single last-emitted-item pointer. A
 * single-item pointer can't be replayed against the branch that DIDN'T emit
 * it (e.g. a ticket id can't seed `listConversationsForAgent`'s
 * conversation-row cursor lookup) without teaching both branches to accept a
 * cross-table timestamp floor. Carrying both native cursors forward instead
 * reuses each branch's already-correct, already-tested keyset semantics
 * unchanged: a branch that contributed zero rows to a page simply replays its
 * previous cursor next time (see `mergeInboxBranches`).
 */
import {
  db,
  eq,
  and,
  isNull,
  inArray,
  sql,
  conversations,
  tickets,
  ticketStatuses,
  ticketConversations,
  type TicketType,
} from '@/lib/server/db'
import type { ConversationId, TicketId, PrincipalId, TeamId, CompanyId } from '@quackback/ids'
import type { ConversationPriority, TicketStage } from '@/lib/shared/db-types'
import { PRIORITY_RANK } from '@/lib/shared/conversation/priority-meta'
import { can } from '@/lib/server/policy/authorize'
import { conversationFilter } from '@/lib/server/policy/conversations'
import { ticketFilter } from '@/lib/server/policy/tickets'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { Actor } from '@/lib/server/policy/types'
import type { TicketAssigneeFilter } from '@/lib/server/domains/tickets/ticket.types'
import {
  facetToConversationStatus,
  facetToTicketStatusCategory,
  type InboxItemDTO,
  type InboxTriageFacet,
  type LinkedTicketSummary,
} from '@/lib/shared/inbox/items'

// ---------------------------------------------------------------------------
// Filter + page contracts
// ---------------------------------------------------------------------------

/** The unified inbox's sorts — a subset of both `ConversationSort` and
 *  `TicketSort` so it type-checks as either branch's `sort` param directly. */
export type InboxSort = 'recent' | 'oldest' | 'created' | 'priority'

export interface InboxListFilter {
  facet: InboxTriageFacet
  /** Restrict to one or both kinds. Omitted = both (subject to RBAC). */
  kinds?: Array<'conversation' | 'ticket'>
  ticketType?: TicketType
  /** A saved view's `ticket_stage` rule (unified inbox §2.8) — no chip sets
   *  this directly. */
  ticketStage?: TicketStage
  priority?: ConversationPriority
  search?: string
  /** 'me' | 'unassigned' | a teammate principal id — shared shape with
   *  `TicketAssigneeFilter`; the conversation branch translates it. */
  assignee?: TicketAssigneeFilter
  teamId?: TeamId
  companyId?: CompanyId
  sort?: InboxSort
  limit?: number
  cursor?: string
}

export interface InboxListPage {
  items: InboxItemDTO[]
  cursor: string | null
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

// ---------------------------------------------------------------------------
// Cursor codec (internal; see the CURSOR CONTRACT note above)
// ---------------------------------------------------------------------------

interface InboxCursorState {
  c: ConversationId | null
  t: TicketId | null
}

const EMPTY_CURSOR: InboxCursorState = { c: null, t: null }

function decodeInboxCursor(cursor: string | undefined): InboxCursorState {
  if (!cursor) return EMPTY_CURSOR
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
    return {
      c: typeof parsed?.c === 'string' ? (parsed.c as ConversationId) : null,
      t: typeof parsed?.t === 'string' ? (parsed.t as TicketId) : null,
    }
  } catch {
    // A malformed/foreign cursor degrades to "start of list" rather than 500ing.
    return EMPTY_CURSOR
  }
}

function encodeInboxCursor(state: InboxCursorState): string {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64url')
}

// ---------------------------------------------------------------------------
// Pure merge (DB-free, unit-tested)
// ---------------------------------------------------------------------------

/** One branch's fetch result, as the pure merge needs it. */
export interface InboxBranchFetch {
  /** Rows already in the branch's own native sort order, length 0..limit+1. */
  items: InboxItemDTO[]
  /** Whether the branch itself has more rows beyond what it fetched. */
  hasMore: boolean
  /** The cursor that was used to produce this fetch (echoed back so a
   *  zero-item branch can carry its position forward unchanged). */
  cursor: ConversationId | TicketId | null
}

export interface MergeInboxBranchesInput {
  conversation: InboxBranchFetch
  ticket: InboxBranchFetch
  sort: InboxSort
  limit: number
}

export interface MergeInboxBranchesResult {
  items: InboxItemDTO[]
  cursor: string | null
}

function itemId(item: InboxItemDTO): string {
  return item.kind === 'conversation' ? item.conversation.id : item.ticket.id
}

function itemPriority(item: InboxItemDTO): ConversationPriority {
  return item.kind === 'conversation' ? item.conversation.priority : item.ticket.priority
}

function itemCreatedAt(item: InboxItemDTO): string {
  return item.kind === 'conversation' ? item.conversation.createdAt : item.ticket.createdAt
}

/** The merge's activity key (§3.1): conversation `lastMessageAt ?? createdAt`;
 *  ticket `updatedAt`. Used for the 'recent'/'oldest' sorts — the inbox's
 *  default and its inverse — which read as "most/least recently active". */
function itemActivityAt(item: InboxItemDTO): string {
  if (item.kind === 'conversation')
    return item.conversation.lastMessageAt ?? item.conversation.createdAt
  return item.ticket.updatedAt
}

/**
 * The numeric sort value for one item under one sort. 'created' reads each
 * branch's own `createdAt` (NOT the activity key — "recently created" must
 * not fold in later message activity, unlike 'recent'/'oldest').
 */
function sortValue(item: InboxItemDTO, sort: InboxSort): number {
  if (sort === 'priority') return PRIORITY_RANK[itemPriority(item)] ?? 1
  if (sort === 'created') return new Date(itemCreatedAt(item)).getTime()
  return new Date(itemActivityAt(item)).getTime()
}

/**
 * Total ordering across both branches for one sort: primary value per
 * direction (desc for recent/created/priority, asc for oldest), tie-broken by
 * kind then id so the comparator is deterministic (required for a stable
 * merge + reproducible cursor derivation).
 */
function compareInboxItems(a: InboxItemDTO, b: InboxItemDTO, sort: InboxSort): number {
  const av = sortValue(a, sort)
  const bv = sortValue(b, sort)
  if (av !== bv) {
    const ascending = sort === 'oldest'
    return ascending ? av - bv : bv - av
  }
  if (a.kind !== b.kind) return a.kind < b.kind ? -1 : 1
  const aId = itemId(a)
  const bId = itemId(b)
  return aId < bId ? -1 : aId > bId ? 1 : 0
}

/** The id of the last (highest-index) item of `kind` in `items`, or null. */
function lastIdOfKind(items: InboxItemDTO[], kind: 'conversation' | 'ticket'): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].kind === kind) return itemId(items[i])
  }
  return null
}

/**
 * Pure merge of the two branches' pages into one activity-ordered page (§3.1).
 * DB-free: takes already-fetched DTOs + each branch's own hasMore/cursor and
 * derives the combined page + the next opaque cursor. See the module's
 * CURSOR CONTRACT note for why the emitted cursor carries both branches'
 * native cursors rather than a single last-item pointer.
 */
export function mergeInboxBranches(input: MergeInboxBranchesInput): MergeInboxBranchesResult {
  const { conversation, ticket, sort, limit } = input
  const combined = [...conversation.items, ...ticket.items].sort((a, b) =>
    compareInboxItems(a, b, sort)
  )
  const truncated = combined.length > limit ? combined.slice(0, limit) : combined
  const overflowed = combined.length > limit

  const hasMore = overflowed || conversation.hasMore || ticket.hasMore
  if (!hasMore) return { items: truncated, cursor: null }

  const nextConversationCursor = lastIdOfKind(truncated, 'conversation') ?? conversation.cursor
  const nextTicketCursor = lastIdOfKind(truncated, 'ticket') ?? ticket.cursor
  return {
    items: truncated,
    cursor: encodeInboxCursor({
      c: (nextConversationCursor as ConversationId | null) ?? null,
      t: (nextTicketCursor as TicketId | null) ?? null,
    }),
  }
}

// ---------------------------------------------------------------------------
// Branch fetchers (impure; DB-backed)
// ---------------------------------------------------------------------------

const EMPTY_BRANCH = (cursor: string | null): InboxBranchFetch => ({
  items: [],
  hasMore: false,
  cursor: cursor as ConversationId | TicketId | null,
})

/**
 * Batch-load the one-row-rule enrichment for a page of conversations: the
 * linked CUSTOMER ticket (at most one per conversation, per the partial
 * unique index), joined through to its status for the chip's display fields.
 * One query for the whole page. Exported so a single-conversation lookup
 * (`getLinkedCustomerTicket`, used by the unified detail panel + header's
 * ticket-status pill on a conversation item) can reuse the same join instead
 * of duplicating it.
 */
export async function loadLinkedCustomerTicketSummaries(
  conversationIds: ConversationId[]
): Promise<Map<ConversationId, LinkedTicketSummary>> {
  const map = new Map<ConversationId, LinkedTicketSummary>()
  if (conversationIds.length === 0) return map
  const rows = await db
    .select({
      conversationId: ticketConversations.conversationId,
      ticketId: tickets.id,
      number: tickets.number,
      statusName: ticketStatuses.name,
      statusCategory: ticketStatuses.category,
    })
    .from(ticketConversations)
    .innerJoin(tickets, eq(tickets.id, ticketConversations.ticketId))
    .innerJoin(ticketStatuses, eq(ticketStatuses.id, tickets.statusId))
    .where(
      and(
        inArray(ticketConversations.conversationId, conversationIds),
        eq(ticketConversations.ticketType, 'customer')
      )
    )
  for (const row of rows) {
    map.set(row.conversationId, {
      id: row.ticketId,
      number: row.number,
      statusName: row.statusName,
      statusCategory: row.statusCategory,
    })
  }
  return map
}

async function fetchConversationBranch(
  actor: Actor,
  filter: InboxListFilter,
  sort: InboxSort,
  limit: number,
  cursor: ConversationId | null
): Promise<InboxBranchFetch> {
  const { listConversationsForAgent } =
    await import('@/lib/server/domains/conversation/conversation.query')
  const assignedAgentPrincipalId: PrincipalId | undefined =
    filter.assignee === 'me'
      ? (actor.principalId ?? undefined)
      : filter.assignee && filter.assignee !== 'unassigned'
        ? filter.assignee
        : undefined

  const page = await listConversationsForAgent(
    {
      status: facetToConversationStatus(filter.facet),
      priority: filter.priority,
      assignedAgentPrincipalId,
      unassignedOnly: filter.assignee === 'unassigned',
      teamId: filter.teamId,
      companyId: filter.companyId,
      search: filter.search,
      sort,
      before: cursor ?? undefined,
      limit,
    },
    actor
  )

  const linkedTickets = await loadLinkedCustomerTicketSummaries(page.conversations.map((c) => c.id))
  const items: InboxItemDTO[] = page.conversations.map((conversation) => ({
    kind: 'conversation',
    conversation,
    linkedTicket: linkedTickets.get(conversation.id) ?? null,
  }))
  return { items, hasMore: page.hasMore, cursor }
}

async function fetchTicketBranch(
  actor: Actor,
  filter: InboxListFilter,
  sort: InboxSort,
  limit: number,
  cursor: TicketId | null
): Promise<InboxBranchFetch> {
  const { listTickets } = await import('@/lib/server/domains/tickets/ticket.service')
  const { ticketUnreadMapForAgent } =
    await import('@/lib/server/domains/tickets/ticket-unread.service')

  const page = await listTickets(
    {
      type: filter.ticketType,
      statusCategory: facetToTicketStatusCategory(filter.facet),
      stage: filter.ticketStage,
      priority: filter.priority,
      assignee: filter.assignee,
      teamId: filter.teamId,
      companyId: filter.companyId,
      search: filter.search,
      sort,
      cursor: cursor ?? undefined,
      limit,
      // One-row rule (§2.1): a linked customer ticket renders as its
      // conversation's row, not its own.
      excludeConversationLinked: true,
    },
    actor
  )

  const unreadMap = await ticketUnreadMapForAgent(page.tickets.map((t) => t.id))
  const items: InboxItemDTO[] = page.tickets.map((ticket) => ({
    kind: 'ticket',
    ticket,
    unreadCount: unreadMap.get(ticket.id) ?? 0,
  }))
  return { items, hasMore: page.hasMore, cursor }
}

// ---------------------------------------------------------------------------
// Union entry point
// ---------------------------------------------------------------------------

/**
 * Whether the actor can view conversations AT ALL (gates whether the branch
 * runs, not row scoping — that's `conversationFilter`). Service principals
 * (API keys, MCP, the AI agent) are workspace-wide by convention throughout
 * the policy layer regardless of their resolved permission set — mirrored
 * here so a service actor's branch isn't wrongly skipped.
 */
function canViewConversations(actor: Actor): boolean {
  return (
    actor.principalType === 'service' ||
    can(actor, PERMISSIONS.CONVERSATION_VIEW) ||
    can(actor, PERMISSIONS.CONVERSATION_VIEW_ALL)
  )
}

/** Ticket-branch analogue of `canViewConversations`. */
function canViewTickets(actor: Actor): boolean {
  return (
    actor.principalType === 'service' ||
    can(actor, PERMISSIONS.TICKET_VIEW) ||
    can(actor, PERMISSIONS.TICKET_VIEW_ALL)
  )
}

/**
 * Whether the actor can view the unified inbox AT ALL (either kind). The
 * server fn's entry gate: `requireAuth()` alone only proves a valid
 * principal, not team membership, so `listInboxItemsFn`/`fetchInboxCountsFn`
 * 403 when this is false.
 */
export function canViewInboxAtAll(actor: Actor): boolean {
  return canViewConversations(actor) || canViewTickets(actor)
}

/**
 * The unified inbox list (UNIFIED-INBOX-SPEC.md §3.1): merges the
 * conversation and ticket branches, each scoped by its own RBAC predicate and
 * paginated with its own native keyset cursor, into one activity-ordered
 * page. An actor lacking a kind's view permission entirely (or who excluded
 * it via `filter.kinds`) never runs that branch's query — it's treated as
 * permanently exhausted, not queried-and-empty.
 */
export async function listInboxItems(
  actor: Actor,
  filter: InboxListFilter
): Promise<InboxListPage> {
  const limit = Math.min(Math.max(filter.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT)
  const sort: InboxSort = filter.sort ?? 'recent'
  const cursorState = decodeInboxCursor(filter.cursor)

  const wantConversations = !filter.kinds || filter.kinds.includes('conversation')
  const wantTickets = !filter.kinds || filter.kinds.includes('ticket')
  const runConversationBranch = wantConversations && canViewConversations(actor)
  const runTicketBranch = wantTickets && canViewTickets(actor)

  const [conversationBranch, ticketBranch] = await Promise.all([
    runConversationBranch
      ? fetchConversationBranch(actor, filter, sort, limit, cursorState.c)
      : Promise.resolve(EMPTY_BRANCH(cursorState.c)),
    runTicketBranch
      ? fetchTicketBranch(actor, filter, sort, limit, cursorState.t)
      : Promise.resolve(EMPTY_BRANCH(cursorState.t)),
  ])

  return mergeInboxBranches({ conversation: conversationBranch, ticket: ticketBranch, sort, limit })
}

// ---------------------------------------------------------------------------
// Counts endpoint
// ---------------------------------------------------------------------------

export interface InboxCounts {
  mine: number
  unassigned: number
  ticketsByType: { customer: number; back_office: number; tracker: number }
}

async function countConversationScope(
  actor: Actor,
  opts: { assignedAgentPrincipalId?: PrincipalId; unassignedOnly?: boolean }
): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(conversations)
    .where(
      and(
        conversationFilter(actor),
        eq(conversations.status, 'open'),
        opts.assignedAgentPrincipalId
          ? eq(conversations.assignedAgentPrincipalId, opts.assignedAgentPrincipalId)
          : undefined,
        opts.unassignedOnly ? isNull(conversations.assignedAgentPrincipalId) : undefined
      )
    )
  return row?.c ?? 0
}

/**
 * Open-ticket counts for all three types in one query, GROUP BY type. The
 * one-row-rule exclusion (`excludeConversationLinkedCondition`) is applied
 * unconditionally rather than only to the customer bucket: the predicate's
 * own shape (`NOT (type = 'customer' AND EXISTS (...))`) is already a no-op
 * for `back_office`/`tracker` rows (the `type = 'customer'` arm is false), so
 * folding it into the shared WHERE reproduces the previous per-type
 * behavior (customer: excluded-if-linked; the other two: unfiltered)
 * without a CASE/FILTER per bucket.
 */
async function countTicketScopesByType(
  actor: Actor
): Promise<{ customer: number; back_office: number; tracker: number }> {
  const { excludeConversationLinkedCondition } =
    await import('@/lib/server/domains/tickets/ticket.service')
  const rows = await db
    .select({ type: tickets.type, c: sql<number>`count(*)::int` })
    .from(tickets)
    .where(
      and(
        ticketFilter(actor),
        inArray(
          tickets.statusId,
          db
            .select({ id: ticketStatuses.id })
            .from(ticketStatuses)
            .where(eq(ticketStatuses.category, 'open'))
        ),
        excludeConversationLinkedCondition()
      )
    )
    .groupBy(tickets.type)
  const byType = new Map(rows.map((r) => [r.type, r.c]))
  return {
    customer: byType.get('customer') ?? 0,
    back_office: byType.get('back_office') ?? 0,
    tracker: byType.get('tracker') ?? 0,
  }
}

/**
 * Nav-badge counts for the inbox (§3.1): "mine"/"unassigned" open
 * conversations, plus open tickets per type (customer counts respect the
 * one-row rule). Bounded by the same RBAC predicates as the list; a kind the
 * actor cannot view at all contributes 0 rather than querying.
 */
export async function countInboxScopes(actor: Actor): Promise<InboxCounts> {
  const canConversations = canViewConversations(actor)
  const canTickets = canViewTickets(actor)

  const [mine, unassigned, ticketsByType] = await Promise.all([
    canConversations && actor.principalId
      ? countConversationScope(actor, { assignedAgentPrincipalId: actor.principalId })
      : Promise.resolve(0),
    canConversations ? countConversationScope(actor, { unassignedOnly: true }) : Promise.resolve(0),
    canTickets
      ? countTicketScopesByType(actor)
      : Promise.resolve({ customer: 0, back_office: 0, tracker: 0 }),
  ])

  return { mine, unassigned, ticketsByType }
}

// ---------------------------------------------------------------------------
// Single-conversation linked-ticket lookup (unified inbox §M5)
// ---------------------------------------------------------------------------

/**
 * The linked CUSTOMER ticket for one conversation (or null), for the unified
 * detail panel's Ticket card + Links section and the thread header's ticket-
 * status pill when a plain conversation links a ticket. Thin wrapper over the
 * same batched join the list branch uses.
 */
export async function getLinkedCustomerTicket(
  conversationId: ConversationId
): Promise<LinkedTicketSummary | null> {
  const map = await loadLinkedCustomerTicketSummaries([conversationId])
  return map.get(conversationId) ?? null
}
