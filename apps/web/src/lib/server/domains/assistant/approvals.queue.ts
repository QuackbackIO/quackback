/**
 * The approvals queue: the requests a viewer may decide, across
 * conversations, tickets, Home threads and requests with no parent, the ones
 * already decided, and one request with its diff. The reads behind the
 * Approvals page, its rail count and Home, and the REST and MCP approval
 * reads.
 *
 * The parent each row hangs off is scoped in SQL by the same rule a decision
 * checks for that one item; whether the viewer holds every permission the
 * operation needs is read per row from the operation itself. A decision checks all of
 * it again, so the queue only decides what is shown, never what is allowed.
 */
import {
  db,
  and,
  or,
  eq,
  gt,
  desc,
  exists,
  inArray,
  isNull,
  isNotNull,
  sql,
  tickets,
  principal,
  user,
  assistantPendingActions,
  inAppNotifications,
  type ApprovalDecisionChannel,
  type ApprovalRequestChannel,
  type ApprovalRisk,
} from '@/lib/server/db'
import type { AssistantPendingActionId, PrincipalId } from '@quackback/ids'
import { ticketFilter } from '@/lib/server/policy/tickets'
import { can } from '@/lib/server/policy/authorize'
import { isTeamActor, type Actor } from '@/lib/server/policy/types'
import { PERMISSIONS, type PermissionKey } from '@/lib/shared/permissions'
import { logger } from '@/lib/server/logger'
import { SETTINGS_PROPOSAL_TOOL } from './approval-policy'
import { approvalDiffOf, type ApprovalDiff } from './approval-content'
import { approvalRequirements } from './approval-requirements'
import {
  approvalNotFound,
  digestForDisplay,
  approvalRiskOf,
  isDecidableApproval,
  requiredApprovalPermissions,
  requesterIsPresent,
} from './approvals.service'

type PendingActionRow = typeof assistantPendingActions.$inferSelect

const log = logger.child({ component: 'approvals-queue' })

export type { ApprovalDiff } from './approval-content'

/** One request, as the queue and its reads show it. */
export interface ApprovalView {
  id: string
  toolName: string
  /** Written by the server from the diff. */
  summary: string
  risk: ApprovalRisk
  status: string
  parent: { kind: 'conversation' | 'ticket' | 'thread' | 'none'; id: string | null }
  requestedVia: ApprovalRequestChannel | null
  requestedById: string | null
  /** The name of the credential, agent or person that asked. */
  requestedByName: string | null
  onBehalfOfPrincipalId: string | null
  /** The name of the person whose authority the request borrows. */
  onBehalfOfName: string | null
  clientName: string | null
  proposedAt: string
  expiresAt: string
  /** The digest a decision on this request must name. */
  contentHash: string
  /** Approving needs an admin who signed in again; turning it down needs only an admin. */
  needsFreshSignIn: boolean
  /** The viewer may decide it now. */
  canDecide: boolean
  decidedById: string | null
  decidedByName: string | null
  decidedAt: string | null
  decidedVia: ApprovalDecisionChannel | null
  decisionReason: string | null
  /** An applied change that can still be put back. */
  undoable: boolean
  /** An applied change that was put back. */
  undone: boolean
  diff: ApprovalDiff
}

/** The requests waiting on a viewer: how many, and the newest few. */
export interface WaitingApprovals {
  count: number
  latest: ApprovalView[]
}

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100
/** Rows read per page before the per-row permission filter. */
const SCAN_LIMIT = 200
/** How many waiting requests Home shows. */
const SUMMARY_LATEST = 3

function parentOf(row: PendingActionRow): ApprovalView['parent'] {
  if (row.conversationId) return { kind: 'conversation', id: row.conversationId }
  if (row.ticketId) return { kind: 'ticket', id: row.ticketId }
  if (row.workspaceThreadKey) return { kind: 'thread', id: null }
  return { kind: 'none', id: null }
}

/** Whether an applied settings change can still be undone, and whether it was. */
function undoStateOf(row: PendingActionRow): Pick<ApprovalView, 'undoable' | 'undone'> {
  const result = row.result
  if (row.toolName !== SETTINGS_PROPOSAL_TOOL || row.status !== 'executed' || !result)
    return { undoable: false, undone: false }
  const undone = typeof result.undoneAt === 'string'
  const effects = result.storageEffects
  return { undoable: !undone && Array.isArray(effects) && effects.length > 0, undone }
}

function holdsAll(actor: Actor, required: ReadonlySet<PermissionKey>): boolean {
  return [...required].every((permission) => can(actor, permission))
}

/**
 * Whether this person is one who may decide this request, whatever state it
 * is in now: not its requester, a role its risk allows, and every permission
 * it needs. A fresh sign-in is set aside.
 */
export function qualifiesToDecide(
  row: Pick<PendingActionRow, 'requestedById' | 'risk' | 'toolName' | 'args'>,
  actor: Actor,
  required: ReadonlySet<PermissionKey>
): boolean {
  const risk = approvalRiskOf(row)
  return (
    row.requestedById !== actor.principalId &&
    risk !== 'critical' &&
    (risk !== 'high' || actor.role === 'admin') &&
    holdsAll(actor, required)
  )
}

/** Whether this viewer could decide this request now, setting aside a fresh sign-in. */
function mayDecide(row: PendingActionRow, actor: Actor, required: ReadonlySet<PermissionKey>) {
  return (
    row.status === 'proposed' &&
    row.expiresAt.getTime() > Date.now() &&
    qualifiesToDecide(row, actor, required)
  )
}

type Names = ReadonlyMap<string, string>

function toView(
  row: PendingActionRow,
  canDecide: boolean,
  names: Names,
  contentHash: string
): ApprovalView {
  const risk = approvalRiskOf(row)
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? null) : null)
  return {
    id: row.id,
    toolName: row.toolName,
    summary: row.summary,
    risk,
    status: row.status,
    parent: parentOf(row),
    requestedVia: row.requestedVia,
    requestedById: row.requestedById,
    requestedByName: nameOf(row.requestedById) ?? row.clientName,
    onBehalfOfPrincipalId: row.onBehalfOfPrincipalId,
    onBehalfOfName: nameOf(row.onBehalfOfPrincipalId),
    clientName: row.clientName,
    proposedAt: row.proposedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    contentHash,
    needsFreshSignIn: risk === 'high',
    canDecide,
    decidedById: row.decidedById,
    decidedByName: nameOf(row.decidedById),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decidedVia: row.decidedVia,
    decisionReason: row.decisionReason,
    ...undoStateOf(row),
    diff: approvalDiffOf(row),
  }
}

/** The names of everyone a set of requests mentions, in one read. */
async function namesFor(rows: readonly PendingActionRow[]): Promise<Names> {
  const ids = [
    ...new Set(
      rows.flatMap((row) => [row.requestedById, row.onBehalfOfPrincipalId, row.decidedById])
    ),
  ].filter((id): id is PrincipalId => !!id)
  if (ids.length === 0) return new Map()
  const people = await db
    .select({ id: principal.id, displayName: principal.displayName, name: user.name })
    .from(principal)
    .leftJoin(user, eq(principal.userId, user.id))
    .where(inArray(principal.id, ids))
  const names = new Map<string, string>()
  for (const person of people) {
    const name = person.name?.trim() || person.displayName?.trim()
    if (name) names.set(person.id, name)
  }
  return names
}

/** Requests as shown; showing one stores the digest a decision on it must name. */
async function toViews(
  rows: readonly PendingActionRow[],
  canDecide: (row: PendingActionRow) => boolean
): Promise<ApprovalView[]> {
  const [names, digests] = await Promise.all([
    namesFor(rows),
    Promise.all(rows.map((row) => digestForDisplay(row))),
  ])
  return rows.map((row, index) => toView(row, canDecide(row), names, digests[index]!))
}

/**
 * Rows whose parent this viewer may see, by the same rule a decision checks
 * for one item, so everyone a request is brought to can find it here. A
 * conversation is visible to any teammate who may view conversations
 * (`canViewConversation`), assigned or not; a ticket by `ticketFilter`, as
 * `assertTicketVisible` reads it. A request with no item is left to the
 * permission check.
 */
export function parentVisible(actor: Actor) {
  return or(
    and(isNull(assistantPendingActions.conversationId), isNull(assistantPendingActions.ticketId)),
    can(actor, PERMISSIONS.CONVERSATION_VIEW)
      ? isNotNull(assistantPendingActions.conversationId)
      : undefined,
    exists(
      db
        .select({ id: tickets.id })
        .from(tickets)
        .where(and(eq(tickets.id, assistantPendingActions.ticketId), ticketFilter(actor)))
    )
  )
}

/** Only teammates decide: a person, never a credential, agent or portal user. */
function isTeammate(actor: Actor): boolean {
  return actor.principalType === 'user' && !!actor.principalId && isTeamActor(actor)
}

/**
 * Requests are listed newest first and read in batches; a page stops after
 * `limit` rows the viewer may see, and the next one starts after the last row
 * read. The cursor is that row's id: the next page compares against the row's
 * own stored time, so no precision is lost on the way.
 */
type ApprovalsList = 'waiting' | 'decided'

/** One page of a list, and where the next one starts, or null at the end. */
export interface ApprovalsPage {
  items: ApprovalView[]
  nextCursor: string | null
}

/** The most requests the waiting count reads; the rail shows 99+ well before it. */
const MAX_COUNT = 999

/** Rows after the cursor row, in the list's order. */
function afterCursor(list: ApprovalsList, cursor: string | null) {
  if (!cursor) return undefined
  const column =
    list === 'waiting' ? assistantPendingActions.proposedAt : assistantPendingActions.decidedAt
  const stored = list === 'waiting' ? sql.raw('anchor.proposed_at') : sql.raw('anchor.decided_at')
  return sql`(${column}, ${assistantPendingActions.id}) < (select ${stored}, anchor.id from ${assistantPendingActions} anchor where anchor.id = ${sql.param(cursor as AssistantPendingActionId, assistantPendingActions.id)})`
}

/**
 * Whether a waiting request is the viewer's to decide. The person whose own
 * assistant asked, in the app, already has the request in front of them, so
 * it does not wait on them; the bell leaves them out the same way.
 */
function waitsOn(row: PendingActionRow, actor: Actor, required: ReadonlySet<PermissionKey>) {
  if (row.onBehalfOfPrincipalId === actor.principalId && requesterIsPresent(row)) return false
  return mayDecide(row, actor, required)
}

/** Whether a decided request is the viewer's to see: theirs, or one they could have decided. */
function decidedFor(
  row: PendingActionRow,
  actor: Actor,
  required: ReadonlySet<PermissionKey> | null
) {
  if (row.decidedById === actor.principalId || row.onBehalfOfPrincipalId === actor.principalId)
    return true
  return !!required && holdsAll(actor, required)
}

/** The rows of a list this viewer may see, from the cursor on, up to `limit`. */
async function scan(
  actor: Actor,
  list: ApprovalsList,
  limit: number,
  cursor: string | null
): Promise<{ rows: PendingActionRow[]; next: string | null }> {
  if (!isTeammate(actor)) return { rows: [], next: null }
  const requiredFor = approvalRequirements()
  const rows: PendingActionRow[] = []
  let after = cursor
  for (;;) {
    const batch = await db
      .select()
      .from(assistantPendingActions)
      .where(
        and(
          list === 'waiting'
            ? and(
                eq(assistantPendingActions.status, 'proposed'),
                gt(assistantPendingActions.expiresAt, new Date())
              )
            : isNotNull(assistantPendingActions.decidedAt),
          parentVisible(actor),
          afterCursor(list, after)
        )
      )
      // Ids are time-ordered, so they break a tie between requests filed together.
      .orderBy(
        desc(
          list === 'waiting'
            ? assistantPendingActions.proposedAt
            : assistantPendingActions.decidedAt
        ),
        desc(assistantPendingActions.id)
      )
      .limit(SCAN_LIMIT)
    for (const [index, row] of batch.entries()) {
      after = row.id
      if (!isDecidableApproval(row)) continue
      const required = await requiredFor(row)
      const shown =
        list === 'waiting'
          ? !!required && waitsOn(row, actor, required)
          : decidedFor(row, actor, required)
      if (!shown) continue
      rows.push(row)
      if (rows.length >= limit) {
        const more = index < batch.length - 1 || batch.length === SCAN_LIMIT
        return { rows, next: more ? after : null }
      }
    }
    if (batch.length < SCAN_LIMIT) return { rows, next: null }
  }
}

function pageLimit(limit: number | undefined): number {
  return Math.max(1, Math.min(limit ?? DEFAULT_LIMIT, MAX_LIMIT))
}

/**
 * One page of the requests waiting on this viewer, or of those decided, newest
 * first; the Approvals page reads every page. Only people decide, so a
 * credential or agent sees empty lists.
 */
export async function pageApprovalsForViewer(
  actor: Actor,
  options: { view: ApprovalsList; limit?: number; cursor?: string | null }
): Promise<ApprovalsPage> {
  const { rows, next } = await scan(
    actor,
    options.view,
    pageLimit(options.limit),
    options.cursor ?? null
  )
  return {
    items: await toViews(rows, () => options.view === 'waiting'),
    nextCursor: next,
  }
}

/** The pending requests this viewer may decide, newest first: the first page. */
export async function listApprovalsForViewer(
  actor: Actor,
  options: { limit?: number } = {}
): Promise<ApprovalView[]> {
  return (await pageApprovalsForViewer(actor, { view: 'waiting', limit: options.limit })).items
}

/**
 * How many requests wait on this viewer, and the newest few: the rail's
 * count, Home's list and the Waiting tab's count, in one read.
 */
export async function waitingApprovalsSummary(actor: Actor): Promise<WaitingApprovals> {
  const { rows } = await scan(actor, 'waiting', MAX_COUNT, null)
  return { count: rows.length, latest: await toViews(rows.slice(0, SUMMARY_LATEST), () => true) }
}

/**
 * The rail's counts for the admin document: the viewer's unread bell and what
 * waits on them, in one statement. The unread count is a read the document
 * makes anyway, so while no request is open anywhere the waiting answer rides
 * along with it and costs no query of its own; the scan runs only once a
 * request is open.
 */
export async function railCountsFor(
  principalId: PrincipalId,
  actorOf: () => Promise<Actor>
): Promise<{ unread: number; waiting: WaitingApprovals }> {
  const result = await db.execute(sql`
    select
      (select count(*)::int from ${inAppNotifications}
        where ${inAppNotifications.principalId} = ${sql.param(principalId, inAppNotifications.principalId)}
          and ${inAppNotifications.archivedAt} is null
          and ${inAppNotifications.readAt} is null) as unread,
      exists (select 1 from ${assistantPendingActions}
        where ${assistantPendingActions.status} = 'proposed'
          and ${assistantPendingActions.expiresAt} > now()) as open
  `)
  const [row] = result as unknown as Array<{ unread: number; open: boolean }>
  return {
    unread: row?.unread ?? 0,
    waiting: row?.open ? await waitingApprovalsSummary(await actorOf()) : { count: 0, latest: [] },
  }
}

/**
 * Requests already decided that this viewer could have decided, decided
 * themselves, or that were filed on their behalf, most recently decided
 * first: the first page.
 */
export async function listDecidedApprovalsForViewer(
  actor: Actor,
  options: { limit?: number } = {}
): Promise<ApprovalView[]> {
  return (await pageApprovalsForViewer(actor, { view: 'decided', limit: options.limit })).items
}

/**
 * A request just decided, as its decider sees the outcome. Built from the
 * settled row rather than read again: the change may have moved its item out
 * of the decider's view, and the decision stands either way.
 */
export async function approvalViewOf(row: PendingActionRow): Promise<ApprovalView> {
  // Names only label the outcome; a failed read of them never undoes it.
  const names = await namesFor([row]).catch((err: unknown) => {
    log.warn({ err, approvalId: row.id }, 'approval names unavailable')
    return new Map<string, string>()
  })
  return toView(row, false, names, await digestForDisplay(row))
}

/**
 * One request with its diff, for a viewer who may decide it or on whose
 * behalf it was filed. Anything else reads as not found, the same as a
 * request that does not exist.
 */
export async function getApprovalForViewer(
  actor: Actor,
  id: AssistantPendingActionId
): Promise<ApprovalView> {
  if (!isTeammate(actor)) throw approvalNotFound()
  const [row] = await db
    .select()
    .from(assistantPendingActions)
    .where(and(eq(assistantPendingActions.id, id), parentVisible(actor)))
    .limit(1)
  if (!row || !isDecidableApproval(row)) throw approvalNotFound()
  const required = await requiredApprovalPermissions(row)
  const qualified = !!required && holdsAll(actor, required)
  if (
    !qualified &&
    row.onBehalfOfPrincipalId !== actor.principalId &&
    row.decidedById !== actor.principalId
  )
    throw approvalNotFound()
  const [view] = await toViews([row], () => !!required && mayDecide(row, actor, required))
  return view!
}
