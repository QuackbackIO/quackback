/**
 * Following approvals from outside the app: the reads an API key or an
 * assistant client uses to see where a request stands, and the shape it reads
 * them in. Nothing here decides. A person decides in the app, on the page an
 * approval's `url` names.
 *
 * Who follows what. A caller reads:
 * - every request it filed: its credential (an API key; for an assistant
 *   client many people sign in through, that client together with the
 *   person signed in), and
 * - the requests the person it acts for could decide, judged with that
 *   person's current permissions narrowed to what the credential may do.
 * Anything else reads as not found, the same as a request that does not
 * exist, so an id tells a caller nothing about requests it may not read.
 *
 * Every title and summary is written by the server. A settings request lists
 * its changes; an assistant action is shown by its label and lists none,
 * because its content can quote what a customer wrote.
 */
import {
  db,
  and,
  or,
  eq,
  ne,
  gt,
  lt,
  lte,
  desc,
  like,
  sql,
  isNull,
  inArray,
  notInArray,
  principal,
  assistantPendingActions,
  type ApprovalDecisionChannel,
  type ApprovalRequestChannel,
  type ApprovalRisk,
} from '@/lib/server/db'
import type { SQL } from 'drizzle-orm'
import type { AssistantPendingActionId, PrincipalId } from '@quackback/ids'
import type { Actor } from '@/lib/server/policy/types'
import { permissionsForPrincipal, resolveActorPermissions } from '@/lib/server/policy/permissions'
import { getBaseUrl } from '@/lib/server/config'
import {
  API_KEY_SCOPES,
  permissionsWithinScopes,
  type ApiKeyScope,
} from '@/lib/shared/api-key-scopes'
import { isTeamMember } from '@/lib/shared/roles'
import { approvalPath, type ApprovalStatus } from '@/lib/shared/assistant/approvals'
import type { JsonValue } from '@/lib/shared/json'
import { DESIGN_PUBLISH_TOOL, SETTINGS_PROPOSAL_TOOL } from './approval-policy'
import { listedChanges } from './approval-content'
import { WORKSPACE_THREAD_PREFIX } from './workspace-safety'
import { approvalNotFound, approvalRiskOf, isDecidableApproval } from './approvals.service'
import { approvalRequirements } from './approval-requirements'
import { parentVisible, qualifiesToDecide } from './approvals.queue'

type PendingActionRow = typeof assistantPendingActions.$inferSelect

/** One field a settings request changes. */
export interface ApprovalChange {
  /** The setting, such as `messenger.enabled`. */
  field: string
  from: JsonValue
  to: JsonValue
}

/** An approval as API and MCP clients read it. */
export interface PublicApproval {
  id: string
  status: ApprovalStatus
  risk: ApprovalRisk
  toolName: string
  title: string
  summary: string
  changes: ApprovalChange[]
  conversationId: string | null
  ticketId: string | null
  requestedVia: ApprovalRequestChannel
  requestedById: string | null
  onBehalfOfPrincipalId: string | null
  clientName: string | null
  createdAt: string
  expiresAt: string
  decidedById: string | null
  decidedAt: string | null
  decidedVia: ApprovalDecisionChannel | null
  /** Why the person rejected it. */
  reason: string | null
  /** When a person undid the applied change; null unless the status is `undone`. */
  undoneAt: string | null
  /** The in-app page a person opens to decide it. */
  url: string
}

/** A page of approvals, newest first. */
export interface ApprovalPage {
  items: PublicApproval[]
  /** The id to pass as `cursor` for the next page, or null on the last one. */
  nextCursor: string | null
  hasMore: boolean
}

/** Who is following, and through what. */
export interface ApprovalFollower {
  /**
   * The requests this caller filed: those its credential filed, and, when
   * many people share the credential (an assistant client), only those filed
   * for the person signed in. Null when the caller has no credential to match.
   */
  filed: { credentialId: string; onBehalfOfPrincipalId?: PrincipalId } | null
  /**
   * The person the caller acts for, with their current permissions narrowed
   * to what the credential may do. Null when that person is no longer a
   * teammate, so the caller reads only what it filed.
   */
  decider: Actor | null
}

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
/** Rows read per query before the per-row permission check. */
const SCAN_BATCH = 200
/** Rows one list call reads at most, however few of them the caller follows. */
const READ_CAP = 1000

type RequestContent = Record<string, unknown>

/**
 * A request's content, read only for a settings request or a design publish,
 * the kinds whose changes a response lists. An assistant action's content
 * never leaves the database here.
 */
const settingsContent =
  sql<RequestContent | null>`CASE WHEN ${assistantPendingActions.toolName} IN (${SETTINGS_PROPOSAL_TOOL}, ${DESIGN_PUBLISH_TOOL}) THEN ${assistantPendingActions.args} END`.mapWith(
    assistantPendingActions.args
  )

/** When an applied change was undone, from its stored result; never the rest of the result. */
const undoneAtOf = sql<string | null>`${assistantPendingActions.result}->>'undoneAt'`

/** The columns a follower read needs. */
const FOLLOW_COLUMNS = {
  id: assistantPendingActions.id,
  toolName: assistantPendingActions.toolName,
  args: settingsContent,
  status: assistantPendingActions.status,
  disposition: assistantPendingActions.disposition,
  risk: assistantPendingActions.risk,
  originRole: assistantPendingActions.originRole,
  conversationId: assistantPendingActions.conversationId,
  ticketId: assistantPendingActions.ticketId,
  workspaceThreadKey: assistantPendingActions.workspaceThreadKey,
  requestedVia: assistantPendingActions.requestedVia,
  requestedById: assistantPendingActions.requestedById,
  onBehalfOfPrincipalId: assistantPendingActions.onBehalfOfPrincipalId,
  credentialId: assistantPendingActions.credentialId,
  clientName: assistantPendingActions.clientName,
  proposedAt: assistantPendingActions.proposedAt,
  expiresAt: assistantPendingActions.expiresAt,
  decidedById: assistantPendingActions.decidedById,
  decidedAt: assistantPendingActions.decidedAt,
  decidedVia: assistantPendingActions.decidedVia,
  decisionReason: assistantPendingActions.decisionReason,
  undoneAt: undoneAtOf,
}

/** A request as a follower read holds it; `args` is empty unless it is a settings request. */
type FollowRow = Pick<
  PendingActionRow,
  Exclude<keyof typeof FOLLOW_COLUMNS, 'args' | 'undoneAt'>
> & {
  args: RequestContent
  undoneAt: string | null
}

/** The disposition prefix of a request a newer, combined one replaced. */
const SUPERSEDED = 'superseded'

/** The in-app page a person opens to decide this approval, as an absolute url. */
export function approvalUrl(id: string): string {
  return `${getBaseUrl().replace(/\/$/, '')}${approvalPath(id)}`
}

/** An approval's state as clients read it. */
export function approvalStatusOf(
  row: Pick<PendingActionRow, 'status' | 'expiresAt' | 'disposition'> & {
    undoneAt: string | null
  },
  now: number = Date.now()
): ApprovalStatus {
  switch (row.status) {
    case 'proposed':
      return row.expiresAt.getTime() > now ? 'pending' : 'expired'
    case 'expired':
      return row.disposition?.startsWith(SUPERSEDED) ? 'superseded' : 'expired'
    case 'executed':
      return row.undoneAt ? 'undone' : 'applied'
    case 'approved':
    case 'rejected':
    case 'failed':
      return row.status
  }
}

/** Rows in one client-facing state, matching approvalStatusOf. */
function statusFilter(status: ApprovalStatus | undefined, now: Date) {
  const table = assistantPendingActions
  switch (status) {
    case undefined:
      return undefined
    case 'pending':
      return and(eq(table.status, 'proposed'), gt(table.expiresAt, now))
    case 'expired':
      return or(
        and(eq(table.status, 'proposed'), lte(table.expiresAt, now)),
        and(
          eq(table.status, 'expired'),
          sql`coalesce(${table.disposition}, '') NOT LIKE ${`${SUPERSEDED}%`}`
        )
      )
    case 'superseded':
      return and(eq(table.status, 'expired'), like(table.disposition, `${SUPERSEDED}%`))
    case 'applied':
      return and(eq(table.status, 'executed'), sql`${undoneAtOf} IS NULL`)
    case 'undone':
      return and(eq(table.status, 'executed'), sql`${undoneAtOf} IS NOT NULL`)
    case 'approved':
    case 'rejected':
    case 'failed':
      return eq(table.status, status)
  }
}

const REQUESTED_BY: Record<ApprovalRequestChannel, string> = {
  assistant: 'by the assistant',
  ui: 'in the app',
  api: 'through the API',
  mcp: 'through MCP',
  workflow: 'by a workflow',
}

/** The title, summary and changes of a request, all written by the server. */
async function describeRequest(
  row: FollowRow
): Promise<Pick<PublicApproval, 'title' | 'summary' | 'changes'>> {
  const listed = listedChanges(row)
  if (listed) return listed
  const { getToolSpecByName } = await import('./assistant.toolspec')
  const where = row.conversationId ? ' in a conversation' : row.ticketId ? ' on a ticket' : ''
  return {
    title: getToolSpecByName(row.toolName)?.label ?? 'Assistant action',
    summary: `Proposed ${REQUESTED_BY[row.requestedVia ?? 'assistant']}${where}.`,
    changes: [],
  }
}

/** One approval as clients read it. Never the stored content beyond a settings diff. */
export async function toPublicApproval(row: FollowRow): Promise<PublicApproval> {
  return {
    id: row.id,
    status: approvalStatusOf(row),
    risk: approvalRiskOf(row),
    toolName: row.toolName,
    ...(await describeRequest(row)),
    conversationId: row.conversationId,
    ticketId: row.ticketId,
    // A request filed before its channel was recorded came from the assistant.
    requestedVia: row.requestedVia ?? 'assistant',
    requestedById: row.requestedById,
    onBehalfOfPrincipalId: row.onBehalfOfPrincipalId,
    clientName: row.clientName,
    createdAt: row.proposedAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    decidedById: row.decidedById,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decidedVia: row.decidedVia,
    reason: row.decisionReason,
    undoneAt: row.undoneAt,
    url: approvalUrl(row.id),
  }
}

/**
 * A person narrowed to what a credential may do: its scopes (null holds them
 * all), and the stricter of the person's role and the credential's own, so a
 * member's credential never reaches what only an admin may decide.
 */
export function narrowToCredential(
  actor: Actor,
  credential: { scopes: readonly ApiKeyScope[] | null; role: Actor['role'] }
): Actor {
  const held = actor.permissions ?? resolveActorPermissions(actor.role)
  return {
    ...actor,
    role: actor.role === 'admin' && credential.role === 'admin' ? 'admin' : 'member',
    permissions: permissionsWithinScopes(held, new Set(credential.scopes ?? API_KEY_SCOPES)),
  }
}

/**
 * What an API key follows: what it filed, and what its creator could decide
 * with the key's authority (the creator's current permissions, the key's own
 * role, and its scopes). A creator who left the team decides nothing here.
 */
export async function approvalFollowerForApiKey(key: {
  id: string
  principalId: PrincipalId
  createdById: PrincipalId | null
  scopes: readonly ApiKeyScope[] | null
}): Promise<ApprovalFollower> {
  return { filed: { credentialId: key.id }, decider: await keyCreatorActor(key) }
}

function isTeamRole(role: string): role is 'admin' | 'member' {
  return isTeamMember(role)
}

async function keyCreatorActor(key: {
  principalId: PrincipalId
  createdById: PrincipalId | null
  scopes: readonly ApiKeyScope[] | null
}): Promise<Actor | null> {
  if (!key.createdById) return null
  const people = await db
    .select({ id: principal.id, role: principal.role, type: principal.type })
    .from(principal)
    .where(inArray(principal.id, [key.createdById, key.principalId]))
  const creator = people.find((person) => person.id === key.createdById)
  const holder = people.find((person) => person.id === key.principalId)
  if (!creator || creator.type !== 'user' || !isTeamRole(creator.role)) return null
  if (!holder || !isTeamRole(holder.role)) return null
  const [creatorHolds, keyHolds] = await Promise.all([
    permissionsForPrincipal(creator.id, creator.role),
    permissionsForPrincipal(holder.id, holder.role),
  ])
  return narrowToCredential(
    {
      principalId: creator.id,
      role: creator.role,
      principalType: 'user',
      segmentIds: new Set(),
      permissions: new Set([...creatorHolds].filter((permission) => keyHolds.has(permission))),
    },
    { scopes: key.scopes, role: holder.role }
  )
}

function filedBy(row: FollowRow, filed: ApprovalFollower['filed']): boolean {
  return (
    !!filed &&
    row.credentialId === filed.credentialId &&
    (!filed.onBehalfOfPrincipalId || row.onBehalfOfPrincipalId === filed.onBehalfOfPrincipalId)
  )
}

/**
 * The rows a person might decide, as far as the query can tell: an item they
 * may see, a kind of request people decide here (isDecidableApproval), a risk
 * their role may decide, and not one they asked for themselves. Whether they
 * hold every permission the operation needs is checked per row after.
 */
function decidableBy(decider: Actor) {
  const table = assistantPendingActions
  return and(
    parentVisible(decider),
    or(
      isNull(table.workspaceThreadKey),
      and(
        like(table.workspaceThreadKey, `${WORKSPACE_THREAD_PREFIX}%`),
        eq(table.toolName, SETTINGS_PROPOSAL_TOOL)
      )
    ),
    // A row with no stored risk is read as low or medium (approvalRiskOf).
    or(
      isNull(table.risk),
      notInArray(table.risk, decider.role === 'admin' ? ['critical'] : ['critical', 'high'])
    ),
    decider.principalId
      ? or(isNull(table.requestedById), ne(table.requestedById, decider.principalId))
      : undefined
  )
}

/** The rows a follower might read, before the per-row permission check; null for none. */
function followerScope(follower: ApprovalFollower) {
  const { filed, decider } = follower
  const own = filed
    ? and(
        eq(assistantPendingActions.credentialId, filed.credentialId),
        filed.onBehalfOfPrincipalId
          ? eq(assistantPendingActions.onBehalfOfPrincipalId, filed.onBehalfOfPrincipalId)
          : undefined
      )
    : undefined
  const decidable = decider ? decidableBy(decider) : undefined
  if (own && decidable) return or(own, decidable)
  return own ?? decidable ?? null
}

async function follows(
  row: FollowRow,
  follower: ApprovalFollower,
  requirementsOf: ReturnType<typeof approvalRequirements>
): Promise<boolean> {
  if (filedBy(row, follower.filed)) return true
  const decider = follower.decider
  if (!decider || !isDecidableApproval(row)) return false
  const required = await requirementsOf(row)
  return !!required && qualifiesToDecide(row, decider, required)
}

/** Read the rows a follower might read, newest first, in the columns a response needs. */
async function readFollowRows(where: SQL | undefined, limit: number): Promise<FollowRow[]> {
  const rows = await db
    .select(FOLLOW_COLUMNS)
    .from(assistantPendingActions)
    .where(where)
    .orderBy(desc(assistantPendingActions.id))
    .limit(limit)
  return rows.map((row) => ({ ...row, args: row.args ?? {} }))
}

/** One approval this caller follows; anything else reads as not found. */
export async function getApprovalForFollower(
  follower: ApprovalFollower,
  id: AssistantPendingActionId
): Promise<PublicApproval> {
  const scope = followerScope(follower)
  if (!scope) throw approvalNotFound()
  const [row] = await readFollowRows(and(eq(assistantPendingActions.id, id), scope), 1)
  if (!row || !(await follows(row, follower, approvalRequirements()))) throw approvalNotFound()
  return toPublicApproval(row)
}

/** How much one list call reads: rows per query, and rows in all. */
export interface ApprovalScan {
  batch: number
  cap: number
}

const DEFAULT_SCAN: ApprovalScan = { batch: SCAN_BATCH, cap: READ_CAP }

/**
 * The approvals this caller follows, newest first, optionally in one state.
 *
 * One call reads at most `scan.cap` rows. When it stops there before the page
 * is full, it returns what it found with `hasMore` and a cursor at the last row
 * it read, so a page can hold fewer items than `limit`, even none, while more
 * remain.
 */
export async function listApprovalsForFollower(
  follower: ApprovalFollower,
  options: { status?: ApprovalStatus; limit?: number; cursor?: AssistantPendingActionId },
  scan: ApprovalScan = DEFAULT_SCAN
): Promise<ApprovalPage> {
  const scope = followerScope(follower)
  if (!scope) return { items: [], nextCursor: null, hasMore: false }
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT))
  const now = new Date()
  const requirementsOf = approvalRequirements()
  const matched: FollowRow[] = []
  let after = options.cursor
  let read = 0
  let lastRead: string | null = null
  let exhausted = false
  while (matched.length <= limit && read < scan.cap) {
    const take = Math.min(scan.batch, scan.cap - read)
    const rows = await readFollowRows(
      and(
        scope,
        statusFilter(options.status, now),
        after ? lt(assistantPendingActions.id, after) : undefined
      ),
      take
    )
    read += rows.length
    exhausted = rows.length < take
    for (const row of rows) {
      lastRead = row.id
      if (await follows(row, follower, requirementsOf)) matched.push(row)
      if (matched.length > limit) break
    }
    if (exhausted) break
    after = rows[rows.length - 1]!.id
  }
  if (matched.length > limit) {
    const page = matched.slice(0, limit)
    return {
      items: await Promise.all(page.map(toPublicApproval)),
      nextCursor: page[page.length - 1]!.id,
      hasMore: true,
    }
  }
  return {
    items: await Promise.all(matched.map(toPublicApproval)),
    // Stopped at the cap: carry on after the last row read.
    nextCursor: exhausted ? null : lastRead,
    hasMore: !exhausted,
  }
}
