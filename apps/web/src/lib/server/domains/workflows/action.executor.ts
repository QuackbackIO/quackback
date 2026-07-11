/**
 * The workflow Action executor (support platform §4.6, Slice 3; Phase C
 * conversational block layer, slice C-1). ONE `applyAction(action, ctx)` runs a
 * single action against a conversation, shared by macros ("a bundle of actions
 * with no trigger") and the workflow engine (a bundle of actions with a trigger +
 * conditions). Keeping the catalogue in one place means a new action is wired
 * once and both surfaces get it.
 *
 * Each action is an independent unit that dispatches to the existing conversation
 * services and returns an ActionResult (a short label of what happened, null
 * label = a deferred no-op; blockMessageId set only for a block-sending action).
 * It THROWS on failure so the caller owns the policy: macros apply best-effort
 * (catch + skip), the engine can fail-fast or continue per its run semantics —
 * this is how the write-once attribute refusal (set-attribute.service.ts) and a
 * failed block send both surface: they throw, the engine's per-action try/catch
 * logs and moves on to the next planned action/edge (the routing decision was
 * already made by the pure walker before any action runs).
 *
 * `set_attribute` writes through the shared domain writer, with provenance
 * derived from the actor by default: a macro runs as the invoking agent (src
 * teammate), the engine's service actor records src workflow. `src` can override
 * that default — the graph walker's collect_data/collect_reply resume path
 * stamps src 'customer' explicitly, since those writes are customer-authored
 * even though they execute under the engine's service actor.
 *
 * Block-sending (`send_block`) posts an assistant-persona message through the
 * SAME write path Quinn's own replies use (conversation.service.ts's
 * appendAssistantReply) — reused, not duplicated — with the resolved rich body
 * (variables interpolated server-side; see workflow-variables.ts +
 * lib/shared/workflows/interpolate.ts) as contentJson and an honest plain-text
 * fallback as content, plus the metadata.block payload the DTO projects.
 * `let_assistant_answer` hands the turn to Quinn via the same out-of-band seam
 * sendVisitorMessage uses for an ordinary customer message
 * (assistant.orchestrator's runAssistantTurnForConversation) — see that case's
 * comment for why it's a dynamic import. `record_csat` writes through
 * conversation.service.ts's recordCsat (amendment 1: latest-wins, not a
 * parallel system) — the engine calls this action with the conversation's
 * VISITOR as the actor (recordCsat requires the caller to BE the visitor),
 * never the run's own service actor.
 *
 * `add_note` posts an agent-only internal note through the SAME write path a
 * teammate's note button uses (conversation.service.ts's addAgentNote) —
 * reused, not hand-rolled — authored by the assistant's service principal
 * (ensureAssistantPrincipal, the same identity send_block posts as) rather
 * than the engine's principalId-less service actor, since addAgentNote's
 * inserted row needs a real principal to attribute the note to. Loop safety:
 * addAgentNote fires message.note_created same as a human-authored note, but
 * the actor threaded through here stays `principalType: 'service'`
 * (workflowActor(), workflow.engine.ts) and event-trigger.ts's
 * message.note_created mapping does NOT set `allowServiceActor` — so
 * dispatchWorkflowTrigger's automated-actor gate blocks a workflow's own
 * add_note from ever re-triggering a note-triggered workflow. Plain text v1
 * (bounded by MAX_CONVERSATION_MESSAGE_LENGTH at the schema, workflow.schemas.ts)
 * — no rich body / mentions yet.
 *
 * `set_ticket_status` resolves the conversation's linked CUSTOMER ticket
 * (getLinkedCustomerTicket, the same join the unified detail panel reads) and
 * calls the tickets domain's setTicketStatus with a locally widened actor
 * (ticketActionActor) — no linked ticket throws, which the engine logs as
 * action_failed and continues past, the same policy add_tag/apply_sla already
 * get on a bad ref. Loop safety: setTicketStatus fires ticket.status_changed,
 * and event-trigger.ts's mapping for it does NOT set `allowServiceActor`, so
 * the human-actor gate blocks this action from ever re-triggering a
 * ticket.status_changed workflow. `convert_to_ticket` is a no-op success
 * ('already a ticket') when the conversation already has a linked customer
 * ticket; otherwise it creates one (title from the conversation's subject or
 * its first visitor message, requester the conversation's visitor) via the
 * tickets domain's createTicketCore directly (bypasses createTicket's own
 * permission gate by design — see createTicketCore's doc) and links it via
 * ticket-conversation-link.service's linkTicketToConversation. Both are
 * class-agnostic fire-and-continue side effects, like close/add_note.
 */
import type {
  ConversationId,
  PrincipalId,
  TeamId,
  ConversationTagId,
  SlaPolicyId,
  ConversationMessageId,
  DataConnectorId,
  TicketStatusId,
  WorkflowRunId,
} from '@quackback/ids'
import type {
  ConversationPriority,
  WorkflowBlockPayload,
  WorkflowBlockButtonOption,
  WorkflowBlockAttributeOption,
  Principal,
} from '@/lib/server/db'
import {
  db,
  eq,
  and,
  asc,
  isNull,
  conversations,
  conversationMessages,
  principal,
  user,
  workflowRuns,
  workflowRunEvents,
  INTERACTIVE_BLOCK_KINDS,
  CSAT_FACES,
} from '@/lib/server/db'
import type { TiptapContent } from '@/lib/shared/db-types'
import type { Actor } from '@/lib/server/policy/types'
import type { ConversationAttributeSource } from '@/lib/shared/conversation/attribute-values'
import type { PermissionKey } from '@/lib/shared/permissions'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { boundedServiceActor } from '@/lib/server/policy/service-actor'

import * as conversationService from '@/lib/server/domains/conversation/conversation.service'
import * as tagService from '@/lib/server/domains/conversation/conversation-tag.service'
import { applySlaToConversation } from '@/lib/server/domains/sla/sla.service'
import { setConversationAttribute } from '@/lib/server/domains/conversation-attributes/set-attribute.service'
import { ensureAssistantPrincipal } from '@/lib/server/domains/assistant/assistant.principal'
import { resolveWorkflowVariables, type WorkflowVariables } from './workflow-variables'
import { interpolate, interpolateTiptapContent } from '@/lib/shared/workflows/interpolate'
import { tiptapJsonToText } from '@/lib/server/markdown-tiptap'
import { logger } from '@/lib/server/logger'
import { realEmail } from '@/lib/shared/anonymous-email'
import {
  executeConnector,
  getConnectorRowForExecution,
} from '@/lib/server/domains/connectors/connector.execute'
import type {
  ConnectorValues,
  ConnectorRuntimeContext,
} from '@/lib/server/domains/connectors/connector.types'
import { NotFoundError } from '@/lib/shared/errors'
import * as ticketService from '@/lib/server/domains/tickets/ticket.service'
import { linkTicketToConversation } from '@/lib/server/domains/tickets/ticket-conversation-link.service'
import { getLinkedCustomerTicket } from '@/lib/server/domains/inbox/inbox.query'
import { resolveReplyRecipient } from '@/lib/server/domains/conversation/conversation.recipient'

const log = logger.child({ component: 'workflow-action-executor' })

/**
 * Ticket action permissions (set_ticket_status / convert_to_ticket): the
 * engine's own bounded service actor (workflow.engine.ts's workflowActor,
 * AUTOMATION_PERMISSIONS) predates ticket actions and carries no `ticket.*`
 * keys — rather than widen that shared ceiling for every other workflow
 * action too, these two actions widen ONLY their own actor, locally, to add
 * exactly the two ticket permissions they need. A human actor (a macro
 * calling applyAction directly) already carries its real permission set via
 * role and passes through unchanged — neither action is in the macro
 * catalogue today (workflow.schemas.ts's actionSchema is workflows-only, like
 * `reopen` before it), so in practice this only ever widens the engine's own
 * service actor.
 */
const TICKET_ACTION_PERMISSIONS: ReadonlySet<PermissionKey> = new Set([
  PERMISSIONS.TICKET_SET_STATUS,
  PERMISSIONS.TICKET_CREATE,
])

function ticketActionActor(actor: Actor): Actor {
  if (actor.principalType !== 'service') return actor
  return boundedServiceActor(
    new Set([...(actor.permissions ?? []), ...TICKET_ACTION_PERMISSIONS]),
    actor.principalId
  )
}

/** send_block's own dependencies, pre-resolved once for an entire plan (SF8
 *  perf fix) rather than re-fetched per action: workflow.engine.ts's
 *  applyPlanAndSettle resolves both in parallel exactly once, BEFORE its
 *  action loop, when the plan contains at least one send_block — mirroring
 *  the resolve-once ConditionContext pattern already used for the walk
 *  itself — and threads the result through every applyAction call in that
 *  plan via WorkflowContext.resolvedBlockDeps. Without this, N chained
 *  send_block actions in one plan (a common shape: message, then buttons, ...)
 *  cost ~3N queries (ensureAssistantPrincipal + resolveWorkflowVariables's own
 *  two reads) instead of 3. */
export interface ResolvedBlockDeps {
  variables: WorkflowVariables
  assistant: Principal
}

/** What an action runs against: the target conversation + the acting principal
 *  (the teammate for a macro, a workflow service actor for the engine — or,
 *  for `record_csat`, the conversation's visitor). The condition evaluator
 *  (Slice 4) extends this with the resolved person/message snapshot; actions
 *  only need these two, plus the run id a block-sending action stamps onto
 *  its posted message. */
export interface WorkflowContext {
  conversationId: ConversationId
  actor: Actor
  /** The workflow run applying this action, when there is one (never set for
   *  a macro). Block-sending actions stamp it into metadata.block.runId. */
  runId?: string
  /** Set only by workflow.engine.ts's applyPlanAndSettle, and only for a plan
   *  with a send_block action — see ResolvedBlockDeps. A macro (which calls
   *  applyAction directly, one action at a time, with no plan to hoist
   *  across) and a plan with no send_block both leave this undefined;
   *  sendBlock falls back to resolving lazily itself in that case, exactly
   *  as it always has. */
  resolvedBlockDeps?: ResolvedBlockDeps
}

/** What `send_block` posts, per block kind — the unresolved template as
 *  authored (a raw `{token}` is resolved at apply time, never stored). */
export type BlockSendSpec =
  | { kind: 'message'; body: TiptapContent }
  | { kind: 'replyTime' }
  | {
      kind: 'buttons'
      body: TiptapContent
      options: WorkflowBlockButtonOption[]
      allowTyping: boolean
    }
  | {
      kind: 'collect'
      body: TiptapContent
      attributeKey: string
      fieldType: 'text' | 'number' | 'select' | 'date'
      options?: WorkflowBlockAttributeOption[]
      required: boolean
    }
  | { kind: 'collectReply'; body: TiptapContent; attributeKey: string }
  | { kind: 'csat'; body: TiptapContent; allowTypingInterrupt: boolean; commentPrompt?: string }

/** The v1 action catalogue this executor applies today. */
export type WorkflowAction =
  | { type: 'assign_agent'; principalId: PrincipalId }
  | { type: 'assign_team'; teamId: TeamId }
  | { type: 'add_tag'; tagId: ConversationTagId }
  | { type: 'remove_tag'; tagId: ConversationTagId }
  | { type: 'set_priority'; priority: ConversationPriority }
  // Two shapes, mirroring workflow.schemas.ts's snoozeActionSchema union: the
  // legacy absolute form (untilIso, an ISO timestamp that's JSON-safe so it
  // round-trips through the stored graph, or null = until the customer next
  // replies) and the relative form (seconds, resolved to `now + seconds`
  // right here at execution time — see the 'snooze' case below — so a
  // workflow re-run always snoozes the same *duration* into the future
  // instead of replaying the same, increasingly stale, absolute instant).
  | { type: 'snooze'; untilIso: string | null }
  | { type: 'snooze'; seconds: number }
  | { type: 'close' }
  // (SF4) The `close` action's counterpart: reopens a closed conversation via
  // the same setConversationStatus seam. Workflows-only for now — a macro's
  // own action catalogue (MacroAction, packages/db/src/schema/macros.ts) plus
  // its authoring UI (the composer's macro-action picker) would both need
  // their own updates for a macro author to ever pick this, which isn't a
  // trivially-free addition alongside this fix; noted rather than done.
  | { type: 'reopen' }
  | { type: 'apply_sla'; policyId: SlaPolicyId }
  // `src` overrides the actor-derived default provenance (see the module doc);
  // omitted for every pre-existing caller (macros, plain workflow actions).
  | { type: 'set_attribute'; key: string; value: unknown; src?: ConversationAttributeSource }
  // Phase C conversational block layer — engine-only (the graph walker is the
  // only producer of these three; macros never emit them).
  | { type: 'send_block'; nodeId: string; block: BlockSendSpec }
  // `instructions` (Phase C, slice C-6): the node's own per-step instruction,
  // if authored — folded into just this turn's system prompt (see
  // runAssistantTurnForConversation's opts below), never persisted config.
  | { type: 'let_assistant_answer'; instructions?: string }
  | { type: 'record_csat'; rating: number; comment?: string }
  // Plain-text v1 internal note — see the module doc's `add_note` paragraph.
  | { type: 'add_note'; body: string }
  // Ticket actions (ticket-actions extension) — see this module's doc for
  // the resolve-the-linked-ticket-then-throw-if-none policy both share, and
  // ticketActionActor's doc for why they run under a locally widened actor.
  | { type: 'set_ticket_status'; statusId: TicketStatusId }
  | { type: 'convert_to_ticket' }

export interface ActionResult {
  /** A short label of what happened, or null for a deferred no-op. */
  label: string | null
  /** Set only by `send_block`: the id of the message it posted, so the engine
   *  can stamp it onto the InputWaitCursor as blockMessageId when the plan
   *  parks right after. */
  blockMessageId?: ConversationMessageId
}

const label = (label: string | null): ActionResult => ({ label })

/** The honest plain-text fallback for a resolved block body, per kind — what
 *  `content` stores (transcript/email/notifications/FTS read this, never the
 *  rich body): the resolved prompt text, plus a bracket button list for
 *  buttons or an emoji row for csat. Never called for `replyTime` — sendBlock
 *  resolves that kind's content from buildReplyTimeMessage instead (see its
 *  own branch above this function's one call site), so the parameter type
 *  excludes it and lets the compiler enforce that reachability. */
function blockFallbackContent(
  resolvedBody: TiptapContent | null,
  block: Exclude<BlockSendSpec, { kind: 'replyTime' }>
): string {
  const bodyText = resolvedBody ? tiptapJsonToText(resolvedBody) : ''
  switch (block.kind) {
    case 'buttons': {
      const list = block.options.map((o) => `[${o.label}]`).join(' ')
      return [bodyText, list].filter(Boolean).join('\n')
    }
    case 'csat':
      return [bodyText, CSAT_FACES.join(' ')].filter(Boolean).join('\n')
    default:
      return bodyText
  }
}

/** Build the full block payload — a plain per-kind switch (not a generic
 *  `Omit<WorkflowBlockPayload, ...>` helper: `keyof` a union type is the
 *  INTERSECTION of its members' keys, so Omit over WorkflowBlockPayload
 *  itself only ever exposes the handful of fields every variant shares,
 *  silently rejecting each kind's own fields at the call site). */
function buildBlockPayload(
  block: BlockSendSpec,
  base: { runId: string; nodeId: string },
  replyTimeStatus: 'online' | 'away' | null
): WorkflowBlockPayload {
  const common = { v: 1 as const, ...base, waiting: INTERACTIVE_BLOCK_KINDS.has(block.kind) }
  switch (block.kind) {
    case 'message':
      return { ...common, kind: 'message' }
    case 'buttons':
      return { ...common, kind: 'buttons', options: block.options, allowTyping: block.allowTyping }
    case 'collect':
      return {
        ...common,
        kind: 'collect',
        attributeKey: block.attributeKey,
        fieldType: block.fieldType,
        options: block.options,
        required: block.required,
      }
    case 'collectReply':
      return { ...common, kind: 'collectReply', attributeKey: block.attributeKey }
    case 'csat':
      return {
        ...common,
        kind: 'csat',
        allowTypingInterrupt: block.allowTypingInterrupt,
        commentPrompt: block.commentPrompt ?? '',
      }
    case 'replyTime':
      return { ...common, kind: 'replyTime', status: replyTimeStatus ?? 'online' }
  }
}

/**
 * Post a block message through the same write path Quinn's own replies use
 * (appendAssistantReply). Resolves variables server-side (a raw `{token}`
 * never reaches storage) and derives the honest content fallback. Returns the
 * posted message's id for the caller to stamp onto an InputWaitCursor.
 */
async function sendBlock(
  conversationId: ConversationId,
  runId: string,
  nodeId: string,
  block: BlockSendSpec,
  resolvedDeps?: ResolvedBlockDeps
): Promise<ConversationMessageId> {
  // Per-plan-resolved when the caller (applyPlanAndSettle) hoisted it — see
  // ResolvedBlockDeps — else resolved lazily here exactly as before (a macro
  // calling applyAction directly, or a standalone applyAction call in tests).
  const assistant = resolvedDeps?.assistant ?? (await ensureAssistantPrincipal())
  const { getMessengerConfig } = await import('@/lib/server/domains/settings/settings.widget')
  const messenger = await getMessengerConfig()

  let resolvedBody: TiptapContent | null = null
  let replyTimeStatus: 'online' | 'away' | null = null
  let content: string
  if (block.kind === 'replyTime') {
    const { getOfficeHoursSchedule } =
      await import('@/lib/server/domains/settings/settings.office-hours')
    const { buildReplyTimeMessage } =
      await import('@/lib/server/domains/office-hours/reply-time-message')
    const schedule = await getOfficeHoursSchedule()
    const resolved = buildReplyTimeMessage(schedule)
    replyTimeStatus = resolved.status
    content = resolved.content
  } else {
    const variables = resolvedDeps?.variables ?? (await resolveWorkflowVariables(conversationId))
    resolvedBody = interpolateTiptapContent(block.body, variables)
    content = blockFallbackContent(resolvedBody, block)
  }

  const messageDTO = await conversationService.appendAssistantReply(
    conversationId,
    content,
    {
      principalId: assistant.id,
      displayName: messenger.assistant?.name ?? 'Quinn',
      avatarUrl: messenger.assistant?.avatarUrl ?? null,
    },
    {
      // Our own turn just spoke; nobody is "waiting on us" until the customer
      // replies again (which sets waitingSince through the ordinary visitor
      // send path) — same as Quinn's normal (non-handover) answer.
      waiting: false,
      contentJson: block.kind === 'replyTime' ? null : resolvedBody,
      metadata: { block: buildBlockPayload(block, { runId, nodeId }, replyTimeStatus) },
    }
  )

  // CSAT-over-email (support platform's CSAT-over-email extension): best-effort,
  // must never fail the block send itself — maybeSendCsatRequestEmail swallows
  // and logs every failure internally.
  if (block.kind === 'csat') {
    await maybeSendCsatRequestEmail(conversationId, resolvedBody)
  }

  return messageDTO.id
}

/**
 * Log the funnel's `block_sent` event (the per-workflow sent -> engaged ->
 * completed rollup, workflow-reporting.ts) for a successful send_block
 * action. Replicated here rather than imported from workflow.engine.ts's
 * logRunEvent — this module is imported BY workflow.engine.ts (applyAction),
 * so an import back the other way would cycle; the insert itself is a
 * couple of lines, cheap to duplicate rather than restructure the module
 * graph for.
 *
 * WorkflowContext only carries the run's own id (see its doc), not its
 * workflowId/subjectPrincipalId — those live on the run row, and
 * workflow_run_events.workflow_id is NOT NULL, so this reads them first, by
 * the run's primary key (one indexed read, paid once per block send, not a
 * new hot path). Best-effort, like maybeSendCsatRequestEmail below: a
 * reporting-ledger write must never fail the block send that already
 * succeeded, so every failure (including the run row having vanished) is
 * caught and logged rather than propagated.
 */
async function logBlockSentEvent(runId: string): Promise<void> {
  try {
    const [run] = await db
      .select({
        workflowId: workflowRuns.workflowId,
        subjectPrincipalId: workflowRuns.subjectPrincipalId,
      })
      .from(workflowRuns)
      .where(eq(workflowRuns.id, runId as WorkflowRunId))
      .limit(1)
    if (!run) return // the run row vanished (a conversation cascade-delete) mid-send
    await db.insert(workflowRunEvents).values({
      runId: runId as WorkflowRunId,
      workflowId: run.workflowId,
      subjectPrincipalId: run.subjectPrincipalId,
      kind: 'block_sent',
    })
  } catch (err) {
    log.warn({ err, runId }, 'block_sent funnel event logging failed')
  }
}

/**
 * When a `request_csat` block posts on a conversation whose active channel is
 * EMAIL (`conversations.channel === 'email'` — set only for a cold-inbound
 * email conversation, conversation.email-cold-inbound.ts; the widget/messenger
 * channels never set it), the customer's only view of this block is their
 * inbox, where the in-app emoji row is inert — so this ALSO sends a dedicated
 * rating-request email with real, one-click emoji links (packages/email's
 * csat-request template). Reuses the exact same offline-reachability signal
 * conversation.notify.ts's notifyAgentReply uses (resolveReplyRecipient over
 * the visitor's account email / captured contact email), not a new one.
 *
 * Best-effort by design: an email provider outage must never fail the block
 * send (the block already posted in-app above), so every failure is caught
 * and logged here rather than propagated.
 */
async function maybeSendCsatRequestEmail(
  conversationId: ConversationId,
  resolvedBody: TiptapContent | null
): Promise<void> {
  try {
    const [conv] = await db
      .select({
        channel: conversations.channel,
        visitorPrincipalId: conversations.visitorPrincipalId,
      })
      .from(conversations)
      .where(eq(conversations.id, conversationId))
      .limit(1)
    if (!conv || conv.channel !== 'email' || !conv.visitorPrincipalId) return
    const visitorPrincipalId = conv.visitorPrincipalId

    const [visitor] = await db
      .select({ type: principal.type, email: user.email, contactEmail: principal.contactEmail })
      .from(principal)
      .leftJoin(user, eq(principal.userId, user.id))
      .where(eq(principal.id, visitorPrincipalId))
      .limit(1)
    const recipient = resolveReplyRecipient(visitor, visitor?.contactEmail, null)
    if (!recipient) return

    const { buildHookContext } = await import('@/lib/server/events/hook-context')
    const ctx = await buildHookContext()
    if (!ctx) return

    const { mintCsatEmailToken } = await import('@/lib/server/functions/csat-email')
    const token = mintCsatEmailToken(conversationId, visitorPrincipalId)
    const base = `${ctx.portalBaseUrl.replace(/\/$/, '')}/csat?token=${encodeURIComponent(token)}`
    const ratingUrls = [1, 2, 3, 4, 5].map((r) => `${base}&rating=${r}`) as [
      string,
      string,
      string,
      string,
      string,
    ]

    const { sendCsatRequestEmail } = await import('@quackback/email')
    await sendCsatRequestEmail({
      to: recipient,
      promptText: resolvedBody ? tiptapJsonToText(resolvedBody) : '',
      ratingUrls,
      workspaceName: ctx.workspaceName,
      logoUrl: ctx.logoUrl ?? undefined,
    })
  } catch (err) {
    log.warn({ err, conversationId }, 'csat request email failed')
  }
}

/**
 * Apply one action to the conversation in `ctx`. Returns an ActionResult.
 * Throws on failure — the caller decides whether to continue.
 */
export async function applyAction(
  action: WorkflowAction,
  ctx: WorkflowContext
): Promise<ActionResult> {
  const { conversationId, actor } = ctx
  switch (action.type) {
    case 'assign_agent':
      await conversationService.assignConversation(conversationId, action.principalId, actor)
      return label('assigned')
    case 'assign_team':
      await conversationService.assignTeam(conversationId, action.teamId, actor)
      return label('assigned to team')
    case 'add_tag':
      await tagService.attachTag(conversationId, action.tagId)
      return label('tagged')
    case 'remove_tag':
      await tagService.detachTag(conversationId, action.tagId)
      return label('untagged')
    case 'set_priority':
      await conversationService.setConversationPriority(conversationId, action.priority, actor)
      return label(`priority ${action.priority}`)
    case 'snooze': {
      const until =
        'seconds' in action
          ? new Date(Date.now() + action.seconds * 1000)
          : action.untilIso
            ? new Date(action.untilIso)
            : null
      await conversationService.snoozeConversation(conversationId, until, actor)
      return label('snoozed')
    }
    case 'close':
      await conversationService.setConversationStatus(conversationId, 'closed', actor)
      return label('closed')
    case 'reopen':
      // Same seam as 'close', target 'open' instead. setConversationStatus is
      // itself already idempotent on a same-status write (its `status !==
      // previous` guard skips the reopened system notice + status_changed
      // event), so an already-open conversation is a no-op in every
      // OBSERVABLE way — no duplicate transcript notice, no re-fired event —
      // without this case needing its own pre-check.
      await conversationService.setConversationStatus(conversationId, 'open', actor)
      return label('reopened')
    case 'apply_sla':
      await applySlaToConversation(conversationId, action.policyId)
      return label('SLA applied')
    case 'set_attribute':
      // Provenance: an explicit src (the graph walker's collect resume) wins;
      // otherwise it follows the actor — the engine's synthetic service actor
      // is a workflow write, a human actor (macro) is the invoking teammate.
      await setConversationAttribute(
        { conversationId },
        action.key,
        action.value,
        action.src ?? (actor.principalType === 'service' ? 'workflow' : 'teammate')
      )
      return label(`set ${action.key}`)
    case 'send_block': {
      if (!ctx.runId) {
        // Structurally unreachable (only the engine, which always has a run,
        // produces this action) — defensive rather than a silent no-op.
        throw new Error('send_block requires a workflow run context')
      }
      const messageId = await sendBlock(
        conversationId,
        ctx.runId,
        action.nodeId,
        action.block,
        ctx.resolvedBlockDeps
      )
      // Funnel: one `block_sent` event per successful post — never suffixed
      // with the block kind (keeps cardinality low; the funnel counts
      // distinct runs, not kinds). Macros never reach this branch (ctx.runId
      // is required above), so this is engine-only, exactly like send_block
      // itself.
      await logBlockSentEvent(ctx.runId)
      return { label: `sent ${action.block.kind} block`, blockMessageId: messageId }
    }
    case 'let_assistant_answer':
      // Out-of-band, same seam a customer message's own turn uses
      // (sendVisitorMessage -> runAssistantTurnForConversation) — dynamic
      // import both because it's fire-and-forget (this action must not block
      // the walk on an LLM turn) and to avoid a static domains/workflows ->
      // domains/assistant edge: assistant.orchestrator.ts already imports
      // FROM domains/workflows (workflow.service's
      // getLiveWorkflowReferencedAttributeKeys), so a static edge back here
      // would be a cycle. `instructions` (Phase C, slice C-6) rides along as
      // an opts field folded into just this turn's prompt — see
      // runAssistantTurnForConversation's doc.
      void import('@/lib/server/domains/assistant/assistant.orchestrator')
        .then((m) =>
          m.runAssistantTurnForConversation(conversationId, {
            stepInstructions: action.instructions,
          })
        )
        .catch((err) => log.warn({ err, conversationId }, 'let_assistant_answer turn failed'))
      return label('handed to assistant')
    case 'record_csat':
      // recordCsat requires the caller to BE the visitor (amendment 1); the
      // engine passes a visitor-scoped actor for this action specifically,
      // never its own service actor.
      await conversationService.recordCsat(conversationId, action.rating, action.comment, actor)
      return label('csat recorded')
    case 'add_note': {
      // Authored by the assistant's service principal (see the module doc) —
      // the same identity send_block posts as — not ctx.actor's own
      // principalId-less service actor, since addAgentNote needs a real
      // principal to attribute the note to.
      const assistant = await ensureAssistantPrincipal()
      await conversationService.addAgentNote(
        conversationId,
        action.body,
        { principalId: assistant.id, displayName: assistant.displayName },
        actor
      )
      return label('note added')
    }
    case 'set_ticket_status': {
      const linked = await getLinkedCustomerTicket(conversationId)
      if (!linked) {
        throw new NotFoundError('NOT_FOUND', 'This conversation has no linked ticket')
      }
      await ticketService.setTicketStatus(linked.id, action.statusId, ticketActionActor(actor))
      return label('ticket status updated')
    }
    case 'convert_to_ticket': {
      const existing = await getLinkedCustomerTicket(conversationId)
      if (existing) return label('already a ticket')

      const linkActor = ticketActionActor(actor)
      const { title, requesterPrincipalId } = await deriveTicketOpeningFields(conversationId)
      const ticket = await ticketService.createTicketCore(
        { type: 'customer', title, requesterPrincipalId },
        linkActor
      )
      await linkTicketToConversation(ticket.id, conversationId, linkActor)
      return label('converted to ticket')
    }
  }
}

/**
 * Title + requester for a fresh ticket opened from a conversation
 * (`convert_to_ticket`): the conversation's own subject when it has one, else
 * an excerpt of its first VISITOR message (mirrors
 * agent-conversation-thread.tsx's manual convert-to-ticket dialog default —
 * `conversation.subject ?? firstVisitorMessage.content.trim().slice(0, 200)`),
 * falling back to a plain placeholder for the rare case neither exists (an
 * empty conversation). The requester is always the conversation's visitor
 * principal, whether or not it resolves to a real principal (createTicketCore
 * accepts null).
 */
async function deriveTicketOpeningFields(
  conversationId: ConversationId
): Promise<{ title: string; requesterPrincipalId: PrincipalId | null }> {
  const [conv] = await db
    .select({
      subject: conversations.subject,
      visitorPrincipalId: conversations.visitorPrincipalId,
    })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)
  if (!conv) throw new NotFoundError('NOT_FOUND', 'Conversation not found')

  let title = conv.subject?.trim() || ''
  if (!title) {
    const [firstVisitorMessage] = await db
      .select({ content: conversationMessages.content })
      .from(conversationMessages)
      .where(
        and(
          eq(conversationMessages.conversationId, conversationId),
          eq(conversationMessages.senderType, 'visitor'),
          isNull(conversationMessages.deletedAt)
        )
      )
      .orderBy(asc(conversationMessages.createdAt))
      .limit(1)
    title = firstVisitorMessage?.content.trim().slice(0, 200) || 'Untitled ticket'
  }
  return {
    title,
    requesterPrincipalId: (conv.visitorPrincipalId ?? null) as PrincipalId | null,
  }
}

// ---------------------------------------------------------------------------
// call_connector — NOT a WorkflowAction (see graph.ts's module doc: the
// walker PARKS at this node rather than pushing an action for it), so this
// isn't dispatched through applyAction above. workflow.engine.ts's
// park-and-continue loop calls this directly once it has the node in hand.
// ---------------------------------------------------------------------------

/** Discriminates a `call_connector` outcome for the engine's routing
 *  (success = the default edge, everything else = the labeled 'failed'
 *  edge) and its run-event logging (`connector_result:success` /
 *  `connector_failed:<reason>`). `unavailable` and `invalid_params` are
 *  local additions on top of ConnectorExecutionResult's own reasons — this
 *  function never lets a missing/disabled connector or a bad template
 *  reach `executeConnector` at all. */
export type CallConnectorReason =
  | 'rate_limited'
  | 'host_not_allowed'
  | 'http_error'
  | 'network_error'
  | 'unavailable'
  | 'invalid_params'

export interface CallConnectorResult {
  ok: boolean
  reason?: CallConnectorReason
}

/** The subset of a `call_connector` graph node this function needs — kept as
 *  a narrow structural type (rather than importing graph.ts's WorkflowNode)
 *  so this module doesn't take on a dependency on the graph shape beyond
 *  what it actually reads. */
export interface CallConnectorSpec {
  connectorId: string
  params: Record<string, string>
  timeoutMs?: number
}

const CALL_CONNECTOR_TIMEOUT_MS_MIN = 1
const CALL_CONNECTOR_TIMEOUT_MS_MAX = 30000

function clampTimeoutMs(ms: number | undefined): number | undefined {
  if (ms === undefined) return undefined
  return Math.min(CALL_CONNECTOR_TIMEOUT_MS_MAX, Math.max(CALL_CONNECTOR_TIMEOUT_MS_MIN, ms))
}

/**
 * Resolve the connector call's OWN builtins ({customer.email} etc.) from the
 * conversation's visitor — the same principal/user join
 * connector.toolspec.ts's resolveRuntimeContext uses for the assistant-tool
 * call path, replicated here (not imported) since that function isn't
 * exported and a `call_connector` node always has a conversation (unlike the
 * tool path's optional ticket-scoped turn, resolveRuntimeContext's `ctx.
 * conversationId` can be absent there) — a simpler, workflow-only version. A
 * lookup failure just means the two builtins render empty (never a reason to
 * fail the call), same policy as the toolspec version.
 */
async function resolveConnectorRuntimeContextForConversation(
  conversationId: ConversationId
): Promise<ConnectorRuntimeContext> {
  try {
    const [row] = await db
      .select({
        displayName: principal.displayName,
        contactEmail: principal.contactEmail,
        userName: user.name,
        userEmail: user.email,
      })
      .from(conversations)
      .innerJoin(principal, eq(principal.id, conversations.visitorPrincipalId))
      .leftJoin(user, eq(user.id, principal.userId))
      .where(eq(conversations.id, conversationId))
      .limit(1)
    if (!row) return { conversationId }
    return {
      customerEmail: realEmail(row.userEmail ?? row.contactEmail),
      customerName: row.userName ?? row.displayName ?? null,
      conversationId,
    }
  } catch {
    return { conversationId }
  }
}

/**
 * Execute a `call_connector` node: interpolate its authored `params`
 * (workflow-variable `{key|fallback}` templates) against the conversation,
 * coerce each to the connector's declared input type, then call the shared
 * connector executor. Never throws — a missing/disabled connector or an
 * unresolvable required input is reported as a normal `CallConnectorResult`,
 * exactly like `executeConnector` itself never throws for a network/HTTP
 * failure, so the engine's park-and-continue loop never needs a try/catch
 * around this call.
 */
export async function executeCallConnectorNode(
  conversationId: ConversationId,
  spec: CallConnectorSpec
): Promise<CallConnectorResult> {
  let row: Awaited<ReturnType<typeof getConnectorRowForExecution>>
  try {
    row = await getConnectorRowForExecution(spec.connectorId as DataConnectorId)
  } catch (err) {
    if (!(err instanceof NotFoundError)) throw err
    return { ok: false, reason: 'unavailable' }
  }
  // getConnectorRowForExecution doesn't gate on enabled/status (it's shared
  // with the admin "test this connector" path, which must reach a disabled
  // connector) — a workflow call must not fire a disabled/opted-out one.
  if (!row.enabled || row.status !== 'active') {
    return { ok: false, reason: 'unavailable' }
  }

  const variables = await resolveWorkflowVariables(conversationId)
  const values: ConnectorValues = {}
  for (const input of row.inputs) {
    const template = spec.params[input.name] ?? ''
    const resolved = interpolate(template, variables).trim()
    if (!resolved) {
      if (input.required) return { ok: false, reason: 'invalid_params' }
      continue // an unresolved optional input is simply omitted (renders as '')
    }
    if (input.type === 'number') {
      const n = Number(resolved)
      if (Number.isNaN(n)) {
        if (input.required) return { ok: false, reason: 'invalid_params' }
        continue
      }
      values[input.name] = n
    } else if (input.type === 'boolean') {
      const lower = resolved.toLowerCase()
      if (lower === 'true') values[input.name] = true
      else if (lower === 'false') values[input.name] = false
      else if (input.required) return { ok: false, reason: 'invalid_params' }
    } else {
      values[input.name] = resolved
    }
  }

  const runtimeCtx = await resolveConnectorRuntimeContextForConversation(conversationId)
  const result = await executeConnector(row, values, runtimeCtx, clampTimeoutMs(spec.timeoutMs))
  if (result.ok) return { ok: true }
  return { ok: false, reason: result.reason }
}
