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
  TicketStatusId,
  TicketTypeId,
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
  sql,
  conversations,
  conversationMessages,
  INTERACTIVE_BLOCK_KINDS,
  CSAT_FACES,
} from '@/lib/server/db'
import type { TiptapContent } from '@/lib/shared/db-types'
import type { Actor } from '@/lib/server/policy/types'
import type { ConversationAttributeSource } from '@/lib/shared/conversation/attribute-values'
import { boundedServiceActor } from '@/lib/server/policy/service-actor'
import { TICKET_ACTION_PERMISSIONS } from './workflow-actor-permissions'

import * as conversationService from '@/lib/server/domains/conversation/conversation.service'
import * as tagService from '@/lib/server/domains/conversation/conversation-tag.service'
import { applySlaToConversation } from '@/lib/server/domains/sla/sla.service'
import { applySlaToTicket } from '@/lib/server/domains/sla/ticket-sla.service'
import { setConversationAttribute } from '@/lib/server/domains/conversation-attributes/set-attribute.service'
import { ensureAssistantPrincipal } from '@/lib/server/domains/assistant/assistant.principal'
import { resolveWorkflowVariables, type WorkflowVariables } from './workflow-variables'
import { logRunEvent } from './workflow-run-events'
import { interpolateTiptapContent } from '@/lib/shared/workflows/interpolate'
import { tiptapJsonToText } from '@/lib/server/markdown-tiptap'
import { logger } from '@/lib/server/logger'
import { NotFoundError } from '@/lib/shared/errors'
import * as ticketService from '@/lib/server/domains/tickets/ticket.service'
import {
  resolveTicketTypeForCreate,
  resolveCategoryDefaultType,
} from '@/lib/server/domains/tickets/ticket-type.service'
import { linkTicketToConversation } from '@/lib/server/domains/tickets/ticket-conversation-link.service'
import { getLinkedCustomerTicket } from '@/lib/server/domains/inbox/inbox.query'

const log = logger.child({ component: 'workflow-action-executor' })

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
  /** The run's own workflowId/subjectPrincipalId, threaded through by the
   *  engine (workflow.engine.ts's applyPlanAndSettle passes workflow.id and
   *  the run's subjectPrincipalId alongside runId) so a ledger write
   *  (send_block's block_sent funnel event) needs no run-row read to
   *  recover them — both already live on the run the engine is holding.
   *  Absent for a macro-applied action, same as runId. */
  workflowId?: string
  subjectPrincipalId?: PrincipalId | null
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
  // `target` picks WHICH object the policy stamps (support platform §4.6's
  // disjoint-targets rule): 'conversation' (the default, and the only behavior
  // pre-target graphs know) stamps the conversation clocks; 'ticket' stamps
  // the policy's time-to-resolve clock onto the conversation's linked
  // CUSTOMER ticket — a no-op success when none is linked, unlike
  // set_ticket_status's throw-if-none (an SLA that has nothing to anchor to
  // is not a misconfiguration worth failing the run over).
  | { type: 'apply_sla'; policyId: SlaPolicyId; target?: 'conversation' | 'ticket' }
  // `src` overrides the actor-derived default provenance (see the module doc);
  // omitted for every pre-existing caller (macros, plain workflow actions).
  | { type: 'set_attribute'; key: string; value: unknown; src?: ConversationAttributeSource }
  | { type: 'send_webhook'; url: string; nodeId?: string }
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
  // Optional ticketTypeId (Phase 4): absent = the customer-category default
  // type; existing graphs convert exactly as before.
  | { type: 'convert_to_ticket'; ticketTypeId?: string }

export interface ActionResult {
  /** A short label of what happened, or null for a deferred no-op. */
  label: string | null
  /** Set only by `send_block`: the id of the message it posted, so the engine
   *  can stamp it onto the InputWaitCursor as blockMessageId when the plan
   *  parks right after. */
  blockMessageId?: ConversationMessageId
}

const label = (label: string | null): ActionResult => ({ label })

/**
 * CSAT once per pair (converged Messages): whether this conversation already
 * carries a CSAT ask — answered (a rating on file) or pending (an earlier
 * csat block in the thread). `conversation.status_changed` and
 * `ticket.status_changed` are independent workflow triggers with no
 * cross-dedup, so a workspace authoring "closed → request CSAT" on both axes
 * would otherwise ask the same customer twice on one pair; the send_block
 * case below skips the second ask instead.
 */
async function conversationAlreadyAskedCsat(conversationId: ConversationId): Promise<boolean> {
  const [conversation] = await db
    .select({ csatRating: conversations.csatRating })
    .from(conversations)
    .where(eq(conversations.id, conversationId))
    .limit(1)
  if (conversation?.csatRating != null) return true
  const [asked] = await db
    .select({ id: conversationMessages.id })
    .from(conversationMessages)
    .where(
      and(
        eq(conversationMessages.conversationId, conversationId),
        isNull(conversationMessages.deletedAt),
        sql`${conversationMessages.metadata} -> 'block' ->> 'kind' = 'csat'`
      )
    )
    .limit(1)
  return asked !== undefined
}

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
  const { getAssistantRuntimeConfig } =
    await import('@/lib/server/domains/settings/settings.assistant')
  const assistantConfig = await getAssistantRuntimeConfig()

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
      displayName: assistantConfig.config.identity.name,
      avatarUrl: assistantConfig.config.identity.avatarUrl,
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
  // must never fail the block send itself — notifyCsatRequestEmail swallows
  // and logs every failure internally (see its own doc in
  // conversation.notify.ts, which owns every other "email the visitor
  // offline" case too). Dynamic import, same as every other CSAT-over-email
  // piece this branch already pulls in lazily (mintCsatEmailToken,
  // sendCsatRequestEmail) — this is a rarely-hit path (email-channel CSAT
  // only), so it stays out of this module's static import graph.
  if (block.kind === 'csat') {
    try {
      const { notifyCsatRequestEmail } =
        await import('@/lib/server/domains/conversation/conversation.notify')
      await notifyCsatRequestEmail(
        conversationId,
        resolvedBody ? tiptapJsonToText(resolvedBody) : ''
      )
    } catch (err) {
      log.warn({ err, conversationId }, 'csat request email failed')
    }
  }

  return messageDTO.id
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
    case 'apply_sla': {
      if (action.target === 'ticket') {
        // Ticket-anchored TTR: stamp the policy's time-to-resolve clock onto
        // the conversation's linked CUSTOMER ticket. No linked ticket is a
        // no-op success (see WorkflowAction's doc) — and a policy without a
        // TTR target no-ops inside applySlaToTicket, so both "nothing to
        // anchor to" cases degrade quietly instead of failing the run.
        const linked = await getLinkedCustomerTicket(conversationId)
        if (!linked) return label(null)
        await applySlaToTicket(linked.id, action.policyId)
        return label('SLA applied to ticket')
      }
      await applySlaToConversation(conversationId, action.policyId)
      return label('SLA applied')
    }
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
    case 'send_webhook': {
      // EVENTING-V2 WO-10: outbound webhook action. Delivered through safeFetch
      // (SSRF chokepoint, no redirects, IP-pinned); dynamic import keeps the
      // executor's static graph unchanged. A non-2xx / network error throws so
      // the engine's retry handles it, same as any other failing action.
      if (!ctx.runId || !ctx.workflowId || !action.nodeId) {
        throw new Error('send_webhook requires workflow run and action identity')
      }
      const deliveryId = `workflow:${ctx.runId}:${action.nodeId}`
      const createdAt = new Date().toISOString()
      const { safeFetch } = await import('@/lib/server/content/ssrf-guard')
      const res = await safeFetch(action.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Quackback-Event': 'workflow.send_webhook',
          'X-Quackback-Delivery-Id': deliveryId,
          'Idempotency-Key': deliveryId,
        },
        body: JSON.stringify({
          id: deliveryId,
          type: 'workflow.send_webhook',
          createdAt,
          data: {
            conversationId,
            workflowId: ctx.workflowId,
            runId: ctx.runId,
            actionId: action.nodeId,
          },
        }),
        timeoutMs: 5000,
      })
      if (!res.ok) throw new Error(`send_webhook HTTP ${res.status}`)
      return label('webhook sent')
    }
    case 'send_block': {
      if (!ctx.runId) {
        // Structurally unreachable (only the engine, which always has a run,
        // produces this action) — defensive rather than a silent no-op.
        throw new Error('send_block requires a workflow run context')
      }
      // CSAT once per pair: skip (don't park) when this conversation was
      // already asked — the conversation- and ticket-axis triggers carry no
      // cross-dedup, so both firing on one pair reaches here twice.
      if (action.block.kind === 'csat' && (await conversationAlreadyAskedCsat(conversationId))) {
        return label('csat skipped — already asked on this thread')
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
      // itself. workflowId is threaded onto ctx by the engine alongside
      // runId (see WorkflowContext's doc), so this needs no run-row read to
      // recover it; guarded on both being present, and best-effort like
      // every other reporting-ledger write in this module — a failure here
      // must never fail the block send that already succeeded.
      if (ctx.runId && ctx.workflowId) {
        try {
          await logRunEvent(ctx.runId, ctx.workflowId, ctx.subjectPrincipalId ?? null, 'block_sent')
        } catch (err) {
          log.warn({ err, runId: ctx.runId }, 'block_sent funnel event logging failed')
        }
      }
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
            surface: 'workflow_step',
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
      // CONVERGENCE PHASE 4: the configured registry type, else the
      // customer-category default (a workspace with no customer types converts
      // legacy-typeless, exactly as before). A misconfigured id — archived,
      // unknown, or NOT a customer-category type — fails the run loudly via
      // resolveTicketTypeForCreate rather than silently filing a
      // wrong-category ticket against the pair rule.
      const ticketTypeId = action.ticketTypeId
        ? (
            await resolveTicketTypeForCreate({
              ticketTypeId: action.ticketTypeId as TicketTypeId,
              category: 'customer',
            })
          ).ticketTypeId
        : ((await resolveCategoryDefaultType('customer'))?.id ?? null)
      const ticket = await ticketService.createTicketCore(
        { ticketTypeId, title, requesterPrincipalId },
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
