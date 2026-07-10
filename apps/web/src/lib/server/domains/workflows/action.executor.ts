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
 */
import type {
  ConversationId,
  PrincipalId,
  TeamId,
  ConversationTagId,
  SlaPolicyId,
  ConversationMessageId,
} from '@quackback/ids'
import type {
  ConversationPriority,
  WorkflowBlockPayload,
  WorkflowBlockButtonOption,
  WorkflowBlockAttributeOption,
  Principal,
} from '@/lib/server/db'
import { INTERACTIVE_BLOCK_KINDS, CSAT_FACES } from '@/lib/server/db'
import type { TiptapContent } from '@/lib/shared/db-types'
import type { Actor } from '@/lib/server/policy/types'
import type { ConversationAttributeSource } from '@/lib/shared/conversation/attribute-values'

import * as conversationService from '@/lib/server/domains/conversation/conversation.service'
import * as tagService from '@/lib/server/domains/conversation/conversation-tag.service'
import { applySlaToConversation } from '@/lib/server/domains/sla/sla.service'
import { setConversationAttribute } from '@/lib/server/domains/conversation-attributes/set-attribute.service'
import { ensureAssistantPrincipal } from '@/lib/server/domains/assistant/assistant.principal'
import { resolveWorkflowVariables, type WorkflowVariables } from './workflow-variables'
import { interpolateTiptapContent } from '@/lib/shared/workflows/interpolate'
import { tiptapJsonToText } from '@/lib/server/markdown-tiptap'
import { logger } from '@/lib/server/logger'

const log = logger.child({ component: 'workflow-action-executor' })

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
  }
}
