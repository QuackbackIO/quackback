/**
 * Custom saved inbox views (support platform §4.6): the client-safe rule model,
 * its zod validation, and the rules→list-filter translation.
 *
 * A view is a saved filter SET, not a server-side query: running it means
 * translating its rules into the ordinary conversation-list params on the
 * client and reusing the same query factory. This module is the single source
 * of truth for the shape — the widget/portal/admin bundles and the server
 * domain all import it (the server can import shared; the client can't import
 * @quackback/db). Zod caps a view at 15 rules per the spec.
 */
import { z } from 'zod'
import type { ConversationViewId } from '@quackback/ids'
import type { ConversationStatus, ConversationPriority } from './types'
import {
  TICKET_TYPES,
  TICKET_STATUS_CATEGORIES,
  TICKET_STAGES,
  type TicketType,
  type TicketStage,
} from '@/lib/shared/db-types'
import {
  INBOX_TRIAGE_FACETS,
  facetToConversationStatus,
  facetToTicketStatusCategory,
  type InboxTriageFacet,
} from '@/lib/shared/inbox/items'

// ── Sorts ──────────────────────────────────────────────────────────────────

/** The inbox sorts. 'recent' (last activity, newest first) is the default. */
export const CONVERSATION_SORTS = [
  'recent',
  'oldest',
  'created',
  'waiting',
  'priority',
  'sla',
] as const
export type ConversationSort = (typeof CONVERSATION_SORTS)[number]
export const DEFAULT_CONVERSATION_SORT: ConversationSort = 'recent'

export function isConversationSort(v: unknown): v is ConversationSort {
  return typeof v === 'string' && (CONVERSATION_SORTS as readonly string[]).includes(v)
}

/** English labels for the sort picker (no locale catalogue yet; see report). */
export const CONVERSATION_SORT_LABELS: Record<ConversationSort, string> = {
  recent: 'Most recent',
  oldest: 'Oldest',
  created: 'Recently created',
  waiting: 'Waiting longest',
  priority: 'Priority',
  sla: 'SLA breach soonest',
}

// ── Rules ────────────────────────────────────────────────────────────────────

export const MAX_VIEW_RULES = 15

/** The rule fields a saved view can filter on (the ones the list query honors).
 *  The last four (unified inbox §2.8) are ticket-only rules: hidden from the
 *  field picker when `supportTickets` is off, and routed through the unified
 *  endpoint rather than the legacy conversation-only list — see
 *  `viewHasTicketRules`/`buildInboxListParams`. */
export const CONVERSATION_VIEW_RULE_FIELDS = [
  'status',
  'priority',
  'assignee',
  'team',
  'tag',
  'source',
  'waiting',
  'kind',
  'ticket_type',
  'ticket_status_category',
  'ticket_stage',
] as const
export type ConversationViewRuleField = (typeof CONVERSATION_VIEW_RULE_FIELDS)[number]

/** Rule fields that only make sense once a view targets tickets — hidden from
 *  the field picker when `supportTickets` is off, and the signal
 *  `viewHasTicketRules` reads to route a view through the unified endpoint. */
export const TICKET_VIEW_RULE_FIELDS = [
  'kind',
  'ticket_type',
  'ticket_status_category',
  'ticket_stage',
] as const satisfies readonly ConversationViewRuleField[]

// A discriminated union keeps each rule's value shape honest. `assignee` is
// 'me' | 'unassigned' | a teammate principal id; `team`/`tag` carry an id;
// `waiting` is a presence flag (only "waiting" makes sense as a saved rule).
// `kind`/`ticket_type`/`ticket_status_category`/`ticket_stage` (§2.8) scope a
// view to conversations, tickets, or a ticket subset — the request routes
// through the unified inbox endpoint whenever any of these four are present.
export const conversationViewRuleSchema = z.discriminatedUnion('field', [
  z.object({ field: z.literal('status'), value: z.enum(['open', 'snoozed', 'closed']) }),
  z.object({
    field: z.literal('priority'),
    value: z.enum(['none', 'low', 'medium', 'high', 'urgent']),
  }),
  z.object({ field: z.literal('assignee'), value: z.string().min(1).max(64) }),
  z.object({ field: z.literal('team'), value: z.string().min(1).max(64) }),
  z.object({ field: z.literal('tag'), value: z.string().min(1).max(64) }),
  z.object({ field: z.literal('source'), value: z.string().min(1).max(32) }),
  z.object({ field: z.literal('waiting'), value: z.literal(true) }),
  z.object({ field: z.literal('kind'), value: z.enum(['conversation', 'ticket']) }),
  z.object({ field: z.literal('ticket_type'), value: z.enum(TICKET_TYPES) }),
  z.object({ field: z.literal('ticket_status_category'), value: z.enum(TICKET_STATUS_CATEGORIES) }),
  z.object({ field: z.literal('ticket_stage'), value: z.enum(TICKET_STAGES) }),
])
export type ConversationViewRule = z.infer<typeof conversationViewRuleSchema>

export const conversationViewFiltersSchema = z.object({
  rules: z.array(conversationViewRuleSchema).max(MAX_VIEW_RULES),
})
export type ConversationViewFilters = z.infer<typeof conversationViewFiltersSchema>

/** A saved view as the inbox nav + dialog consume it (per-viewer `isPinned`). */
export interface ConversationViewDTO {
  id: ConversationViewId
  name: string
  filters: ConversationViewFilters
  sort: ConversationSort | null
  isShared: boolean
  isPinned: boolean
}

// ── Translation ──────────────────────────────────────────────────────────────

/**
 * The subset of the conversation-list params a view can drive. Mirrors the
 * fields `listConversationsFn` accepts; sort + search + company ride alongside
 * from the URL, not the view.
 */
export interface ConversationViewListParams {
  status?: ConversationStatus
  priority?: ConversationPriority
  /** 'me' | 'unassigned' | a teammate principal id. */
  assignee?: string
  teamId?: string
  tagIds?: string[]
  source?: string
  waitingOnly?: boolean
}

/**
 * Translate a view's saved rules into list-query params (client-side). Rules
 * combine with AND; repeated `tag` rules collect into the OR-semantics tagIds
 * array (matching the inbox tag filter). Later rules win for single-valued
 * fields. Custom-attribute rules are intentionally absent until the
 * conversation.set_attributes query capability lands (see report).
 */
export function viewFiltersToListParams(
  filters: ConversationViewFilters
): ConversationViewListParams {
  const params: ConversationViewListParams = {}
  const tagIds: string[] = []
  for (const rule of filters.rules) {
    switch (rule.field) {
      case 'status':
        params.status = rule.value
        break
      case 'priority':
        params.priority = rule.value
        break
      case 'assignee':
        // The dialog emits 'me' for the current viewer; the server list fn
        // resolves 'mine'. Normalize so an "Assignee = Me" view scopes to self
        // rather than matching every conversation. 'unassigned' and any
        // teammate principal id pass through unchanged.
        params.assignee = rule.value === 'me' ? 'mine' : rule.value
        break
      case 'team':
        params.teamId = rule.value
        break
      case 'tag':
        tagIds.push(rule.value)
        break
      case 'source':
        params.source = rule.value
        break
      case 'waiting':
        params.waitingOnly = true
        break
    }
  }
  if (tagIds.length > 0) params.tagIds = tagIds
  return params
}

// ── Ticket rules → unified inbox params (unified inbox §2.8) ───────────────

/** Whether any of `filters`' rules only make sense against tickets (`kind`,
 *  `ticket_type`, `ticket_status_category`, `ticket_stage`). A view carrying
 *  one of these routes through the unified `inboxQueries.itemList` endpoint
 *  instead of the legacy conversation-only list — see
 *  `viewFiltersToInboxParams` for the translated params. */
export function viewHasTicketRules(filters: ConversationViewFilters): boolean {
  return filters.rules.some((r) => (TICKET_VIEW_RULE_FIELDS as readonly string[]).includes(r.field))
}

/** The subset of the unified inbox list filter a view's rules can drive, once
 *  it's routed through the unified endpoint (`viewHasTicketRules` is true).
 *  Mirrors `lib/client/conversation/inbox-scope.ts`'s `InboxListParams` shape
 *  (that module can't import this one's zod-adjacent types without a cycle,
 *  so the route composes the two by hand — see `buildInboxListParams`).
 *  `tag`/`source`/`waiting` rules have no unified-endpoint equivalent yet (the
 *  endpoint carries no tagIds/segmentIds support — see inbox-scope.ts's module
 *  note) and are silently dropped here, same as they would 400 if forwarded. */
export interface TicketViewRuleParams {
  /** Defaults to `['ticket']` once any ticket-only field is present, or the
   *  literal `kind` rule's value when that's the only ticket-only rule set. */
  kinds: Array<'conversation' | 'ticket'>
  ticketType?: TicketType
  /** From a `ticket_status_category` or conversation `status` rule, mapped
   *  onto the unified endpoint's triage facet vocabulary. 'all' (no rule)
   *  when the view doesn't constrain either. A `ticket_status_category` rule
   *  wins when both are somehow present (unusual, but deterministic). */
  facet: 'open' | 'waiting' | 'closed' | 'all'
  ticketStage?: TicketStage
  priority?: ConversationPriority
  /** 'me' | 'unassigned' | a teammate principal id — the unified endpoint's
   *  OWN assignee vocabulary (unlike `viewFiltersToListParams`'s 'mine'). */
  assignee?: string
  teamId?: string
}

/** Build a facet's inverse map by running the forward mapper (items.ts) over
 *  every non-'all' facet — so a new facet/category value only has to be taught
 *  to the forward function, not kept in sync by hand in a second table here. */
function invertFacetMap<V extends string>(
  forward: (facet: InboxTriageFacet) => V | undefined
): Record<V, 'open' | 'waiting' | 'closed'> {
  const out = {} as Record<V, 'open' | 'waiting' | 'closed'>
  for (const facet of INBOX_TRIAGE_FACETS) {
    if (facet === 'all') continue
    const value = forward(facet)
    if (value !== undefined) out[value] = facet
  }
  return out
}

const CATEGORY_TO_FACET = invertFacetMap(facetToTicketStatusCategory)

const CONVERSATION_STATUS_TO_FACET = invertFacetMap(facetToConversationStatus)

/**
 * Translate a view's rules into unified-endpoint params. Only called once
 * `viewHasTicketRules` is true; a conversation-only view never reaches this
 * (it stays on `viewFiltersToListParams` + the legacy endpoint). Later rules
 * win for single-valued fields, matching `viewFiltersToListParams`. A bare
 * `kind` rule with no other ticket field sets the requested kind(s) directly;
 * any of `ticket_type`/`ticket_status_category`/`ticket_stage` implies
 * tickets-only unless overridden by a later `kind` rule.
 */
export function viewFiltersToInboxParams(filters: ConversationViewFilters): TicketViewRuleParams {
  let kind: 'conversation' | 'ticket' | undefined
  let ticketType: TicketType | undefined
  let facet: 'open' | 'waiting' | 'closed' | 'all' = 'all'
  let ticketStage: TicketStage | undefined
  let priority: ConversationPriority | undefined
  let assignee: string | undefined
  let teamId: string | undefined
  let hasTicketField = false

  for (const rule of filters.rules) {
    switch (rule.field) {
      case 'kind':
        kind = rule.value
        break
      case 'ticket_type':
        ticketType = rule.value
        hasTicketField = true
        break
      case 'ticket_status_category':
        facet = CATEGORY_TO_FACET[rule.value]
        hasTicketField = true
        break
      case 'ticket_stage':
        ticketStage = rule.value
        hasTicketField = true
        break
      case 'status':
        facet = CONVERSATION_STATUS_TO_FACET[rule.value]
        break
      case 'priority':
        priority = rule.value
        break
      case 'assignee':
        assignee = rule.value
        break
      case 'team':
        teamId = rule.value
        break
    }
  }

  const kinds: Array<'conversation' | 'ticket'> = kind ? [kind] : hasTicketField ? ['ticket'] : []
  return { kinds, ticketType, facet, ticketStage, priority, assignee, teamId }
}
