/**
 * Server functions for the unified inbox union endpoint
 * (UNIFIED-INBOX-SPEC.md §3.1): the merged conversation+ticket list and its
 * nav-badge counts. Both gate on `requireAuth()` (any valid principal —
 * proves authentication, not team membership) plus a handler-level either-or
 * check (`conversation.view`/`view_all` OR `ticket.view`/`view_all`), since
 * `requireAuth({ permission })` only accepts a single permission. The domain
 * service is dynamically imported so it never reaches the client bundle.
 */
import { z } from 'zod'
import { createServerFn } from '@tanstack/react-start'
import { isValidTypeId } from '@quackback/ids'
import type { PrincipalId, TeamId, CompanyId } from '@quackback/ids'
import { TICKET_TYPES, CONVERSATION_PRIORITIES } from '@/lib/shared/db-types'
import { INBOX_TRIAGE_FACETS } from '@/lib/shared/inbox/items'
import { ForbiddenError } from '@/lib/shared/errors'
import { requireAuth, policyActorFromAuth } from './auth-helpers'

const ticketTypeSchema = z.enum(TICKET_TYPES)
const prioritySchema = z.enum(CONVERSATION_PRIORITIES)
const inboxSortSchema = z.enum(['recent', 'oldest', 'created', 'priority'])

export const listInboxItemsSchema = z.object({
  facet: z.enum(INBOX_TRIAGE_FACETS),
  kinds: z
    .array(z.enum(['conversation', 'ticket']))
    .min(1)
    .max(2)
    .optional(),
  ticketType: ticketTypeSchema.optional(),
  priority: prioritySchema.optional(),
  search: z.string().optional(),
  /** 'me' | 'unassigned' | a teammate principal id; validated in the handler
   *  (mirrors listTicketsFn/listConversationsFn's assignee handling). */
  assignee: z.string().optional(),
  teamId: z.string().optional(),
  companyId: z.string().optional(),
  sort: inboxSortSchema.optional(),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().optional(),
})

/** The unified inbox list (union of conversations + tickets, RBAC-scoped
 *  per-branch). See inbox.query.ts's `listInboxItems` for the merge contract. */
export const listInboxItemsFn = createServerFn({ method: 'GET' })
  .validator(listInboxItemsSchema)
  .handler(async ({ data }) => {
    const ctx = await requireAuth()
    const actor = await policyActorFromAuth(ctx)
    const { canViewInboxAtAll, listInboxItems } =
      await import('@/lib/server/domains/inbox/inbox.query')
    if (!canViewInboxAtAll(actor)) {
      throw new ForbiddenError('FORBIDDEN', 'You cannot view the inbox')
    }

    // assignee is 'me' | 'unassigned' | a teammate principal id. A junk value
    // is dropped so it can never reach the uuid-backed queries.
    const assignee =
      data.assignee === 'me' || data.assignee === 'unassigned'
        ? data.assignee
        : data.assignee && isValidTypeId(data.assignee, 'principal')
          ? (data.assignee as PrincipalId)
          : undefined

    return listInboxItems(actor, {
      facet: data.facet,
      kinds: data.kinds,
      ticketType: data.ticketType,
      priority: data.priority,
      search: data.search,
      assignee,
      teamId:
        data.teamId && isValidTypeId(data.teamId, 'team') ? (data.teamId as TeamId) : undefined,
      companyId:
        data.companyId && isValidTypeId(data.companyId, 'company')
          ? (data.companyId as CompanyId)
          : undefined,
      sort: data.sort,
      limit: data.limit,
      cursor: data.cursor,
    })
  })

/** Nav-badge counts for the inbox (mine/unassigned/tickets-by-type), bounded
 *  by the same RBAC predicates as the list. */
export const fetchInboxCountsFn = createServerFn({ method: 'GET' }).handler(async () => {
  const ctx = await requireAuth()
  const actor = await policyActorFromAuth(ctx)
  const { canViewInboxAtAll, countInboxScopes } =
    await import('@/lib/server/domains/inbox/inbox.query')
  if (!canViewInboxAtAll(actor)) {
    throw new ForbiddenError('FORBIDDEN', 'You cannot view the inbox')
  }
  return countInboxScopes(actor)
})
