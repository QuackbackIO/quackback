import type {
  ConversationMessageDTO,
  AssistantActivityStatus,
  ConversationStatus,
  BlockState,
} from '@/lib/shared/conversation/types'
import type { WorkflowBlockPayload } from '@/lib/shared/db-types'
import { INTERACTIVE_BLOCK_KINDS } from '@/lib/shared/db-types'

/**
 * A conversational block's derived interaction state (Phase C, PHASE-C-BLOCK-
 * CONTRACT.md §"Widget state derivation"), computed fresh from the message
 * list + conversation status on every render — never client memory, so a
 * refresh or a late SSE append reproduces the exact same state:
 *  - 'chosen': a later visitor message carries a `blockReply` whose
 *    `inReplyToMessageId` matches this block message's own id.
 *  - 'superseded' (amendment 2, widened): not chosen, and either a later
 *    visitor message exists that ISN'T this block's matching reply, a later
 *    HUMAN teammate message exists (a teammate took over — the run was
 *    interrupted, so a still-tappable stack would be a dead affordance), or
 *    the block PREDATES the conversation's most recent transition to closed
 *    (amendment 3, below). A later ASSISTANT/run message never supersedes
 *    (the bot can keep talking around a still-pending block).
 *  - 'pending': none of the above — still tappable/awaiting input.
 * Only assigned to interactive block kinds (buttons/collect/collectReply/
 * csat), which are the only ones that ever park a run awaiting a reply; SEND
 * kinds (message/replyTime) have no state.
 *
 * Amendment 3 (post-close blocks stay live): a "close-resumes-default" flow
 * (e.g. the shipped `post-resolution-follow-up` template, triggered on
 * conversation.status_changed -> closed) posts its CSAT/buttons block AFTER
 * the conversation has already closed. Blanket-superseding every interactive
 * block whenever `conversationClosed` is true would bury that block dead on
 * arrival. The ordering signal used to tell "before" from "after" is the
 * conversation's own `chat_ended` system row: conversation.service.ts emits
 * one on every close transition (and a `chat_reopened` one on every reopen),
 * so it already rides in `messages` in chronological order — an in-list
 * position check, not a timestamp compare (preferred: no clock-skew risk, and
 * it's already the ordering axis the reply/blockReply widening above uses).
 * Only the LAST `chat_ended` row matters: a block emitted before it belongs to
 * a stale close-then-reopen cycle and stays subject to the supersede rule;
 * one emitted after it is the current close's own follow-up and stays
 * 'pending' (until answered, or the usual visitor/teammate supersede rules
 * catch it). When no `chat_ended` row exists at all (older data predating
 * this event, or a status derived without ever routing through the emitter)
 * there's no in-list signal to key on, so every block conservatively counts
 * as predating the close — the exact pre-amendment-3 behavior.
 *
 * The `BlockState` union itself now lives in lib/shared/conversation/types.ts
 * (re-exported here unchanged) so lib/client code can type a block-states map
 * without reaching across the lib/-must-not-import-components/ boundary —
 * see that module's doc comment on `BlockState`.
 */
export type { BlockState }

/**
 * Compute every interactive block message's state in two linear passes over
 * `messages` (no client memory, no re-derivation loop per block): a backward
 * pass builds, for each position, whether any visitor/human-teammate message
 * follows it (suffix flags) plus a map of every blockReply's target id; a
 * forward pass then assigns each interactive block's state from that
 * precomputed data. O(n) total rather than an O(n²) "scan forward from every
 * block" — still exactly the single conceptual pass the contract calls for
 * (one read of the message list drives the whole derivation).
 *
 * Exported so a single render can compute it ONCE (typically a `useMemo`
 * keyed on `[messages, conversationStatus]`) and thread the same result into
 * `buildConversationRows`, `derivePendingBlock`/`deriveComposerLock`, and any
 * send-time lookup, instead of each of those re-scanning `messages` on its
 * own — see those functions' own `precomputedStates` parameter.
 */
export function computeBlockStates(
  messages: ConversationMessageDTO[],
  conversationClosed: boolean
): Map<string, BlockState> {
  const states = new Map<string, BlockState>()
  const n = messages.length
  const suffixVisitor: boolean[] = new Array(n)
  const suffixHumanTeammate: boolean[] = new Array(n)
  const replyTargets = new Set<string>()

  // Amendment 3's ordering signal: the position of the LAST `chat_ended`
  // system row (see this module's BlockState doc). -1 when none exists.
  let lastCloseIndex = -1
  for (let i = 0; i < n; i++) {
    const m = messages[i]
    if (m.senderType === 'system' && m.systemEvent?.kind === 'chat_ended') lastCloseIndex = i
  }
  // No in-list signal at all: fall back to "every block predates the close"
  // (the pre-amendment-3 behavior) rather than silently un-superseding
  // everything for lack of data.
  const hasCloseSignal = lastCloseIndex !== -1

  let anyVisitorAfter = false
  let anyHumanTeammateAfter = false
  for (let i = n - 1; i >= 0; i--) {
    // Captured BEFORE folding in messages[i] itself, so these represent
    // "exists at some index > i" — exactly what supersede/chosen need.
    suffixVisitor[i] = anyVisitorAfter
    suffixHumanTeammate[i] = anyHumanTeammateAfter
    const m = messages[i]
    if (m.senderType === 'visitor') {
      anyVisitorAfter = true
      if (m.blockReply) replyTargets.add(m.blockReply.inReplyToMessageId)
    } else if (m.senderType === 'agent' && !m.isAssistant) {
      anyHumanTeammateAfter = true
    }
  }

  for (let i = 0; i < n; i++) {
    const m = messages[i]
    if (m.senderType !== 'agent' || !m.block || !INTERACTIVE_BLOCK_KINDS.has(m.block.kind)) {
      continue
    }
    const id = m.id as unknown as string
    const predatesLastClose = !hasCloseSignal || i < lastCloseIndex
    if (replyTargets.has(id)) {
      states.set(id, 'chosen')
    } else if (
      suffixVisitor[i] ||
      suffixHumanTeammate[i] ||
      (conversationClosed && predatesLastClose)
    ) {
      states.set(id, 'superseded')
    } else {
      states.set(id, 'pending')
    }
  }
  return states
}

/**
 * Whether the thread already carries a `request_csat` (block `kind: 'csat'`)
 * message, in ANY state. Drives suppressing the legacy end-of-thread CSAT
 * prompt (visitor-conversation-thread.tsx's `showCsatPrompt`) so it never
 * stacks a second ask underneath a workflow's own CSAT block: pending is the
 * live ask already on screen, chosen means a rating is already on file (the
 * legacy prompt's own "thanks" would be a second, redundant one), and even a
 * superseded-unanswered block already showed the visitor one ask — a second
 * one from the legacy path would look like the widget forgot the first.
 * A pure predicate (not folded into `computeBlockStates`, which is scoped to
 * per-block *interaction* state) so it's directly unit-testable and doesn't
 * force every caller to thread block states through just to answer this one
 * yes/no question.
 */
export function hasCsatBlockMessage(messages: ConversationMessageDTO[]): boolean {
  return messages.some((m) => m.block?.kind === 'csat')
}

/** The single block currently parking the run and awaiting a customer
 *  reply, or null when nothing is pending (at most one exists at a time —
 *  the engine's exclusive per-conversation lock guarantees it). Composer
 *  lock derivation and the collectReply auto-correlate-on-send both key off
 *  this one lookup. */
export interface PendingBlock {
  messageId: string
  block: WorkflowBlockPayload
}

export function derivePendingBlock(
  messages: ConversationMessageDTO[],
  conversationStatus: ConversationStatus | null,
  /** Reuse an already-computed scan (e.g. the render's own `useMemo` over
   *  `computeBlockStates`) instead of re-deriving it here — callers that
   *  don't have one yet (every existing unit test, any one-off call site)
   *  keep working unchanged; this only saves the redundant O(n) pass when a
   *  caller has the states already in hand. */
  precomputedStates?: Map<string, BlockState>
): PendingBlock | null {
  const states = precomputedStates ?? computeBlockStates(messages, conversationStatus === 'closed')
  for (const m of messages) {
    if (m.senderType !== 'agent' || !m.block) continue
    const id = m.id as unknown as string
    if (states.get(id) === 'pending') return { messageId: id, block: m.block }
  }
  return null
}

/** Composer lock derived from the pending block's `allowTyping` (contract
 *  §"Interrupt matrix"): buttons/csat with typing disallowed lock the
 *  composer in place; collect/collectReply always leave it enabled (a
 *  non-matching reply is an interrupt by design for `collect`; `collectReply`
 *  IS the composer — see derivePendingBlock's collectReply auto-correlation
 *  at the send call site). */
export interface ComposerLock {
  disabled: boolean
  /** The kind driving the lock, for hint-text lookup — null when unlocked. */
  lockedBy: 'buttons' | 'csat' | null
}

export function deriveComposerLock(
  messages: ConversationMessageDTO[],
  conversationStatus: ConversationStatus | null,
  /** See derivePendingBlock's own doc — threaded through unchanged. */
  precomputedStates?: Map<string, BlockState>
): ComposerLock {
  const pending = derivePendingBlock(messages, conversationStatus, precomputedStates)
  if (!pending) return { disabled: false, lockedBy: null }
  const disabled =
    pending.block.kind === 'buttons'
      ? !pending.block.allowTyping
      : pending.block.kind === 'csat'
        ? !pending.block.allowTypingInterrupt
        : false
  if (!disabled) return { disabled: false, lockedBy: null }
  return { disabled: true, lockedBy: pending.block.kind as 'buttons' | 'csat' }
}

/**
 * A single virtualized row in the conversation thread. Messages are keyed by their id
 * (stable across prepend, so the virtualizer can anchor the viewport when older
 * history loads); the surrounding affordances use fixed keys.
 */
export type ConversationRow =
  | { type: 'load-older'; key: 'load-older' }
  | { type: 'greeting'; key: 'greeting' }
  // `blockState` is set only when `message.block` is a non-null interactive
  // kind (buttons/collect/collectReply/csat) — undefined for an ordinary
  // message or a SEND-kind block (message/replyTime), which render as a
  // plain bubble with no affordance to gate.
  | { type: 'message'; key: string; message: ConversationMessageDTO; blockState?: BlockState }
  | { type: 'system'; key: string; message: ConversationMessageDTO }
  | { type: 'empty'; key: 'empty' }
  | { type: 'seen'; key: 'seen' }
  | { type: 'typing'; key: 'typing' }
  // Ephemeral AI-assistant rows: the live working trace, or the answer as it
  // streams (replaced by the persisted message row when the turn lands).
  | { type: 'assistant-activity'; key: 'assistant-activity'; status: AssistantActivityStatus }
  | { type: 'assistant-stream'; key: 'assistant-stream'; text: string }
  | { type: 'csat'; key: 'csat' }

export interface ConversationRowsInput {
  messages: ConversationMessageDTO[]
  /** A "load earlier messages" affordance sits above the thread. */
  hasMoreOlder: boolean
  /** The settings-driven welcome bubble (only once the thread start is reached). */
  hasGreeting: boolean
  /** Empty-thread prompt (no messages and no greeting). */
  showEmpty: boolean
  /** "Seen" watermark on the visitor's latest message. */
  showSeen: boolean
  /** Agent typing indicator. */
  showTyping: boolean
  /** Quinn's current working status while its turn runs (null when idle). */
  assistantActivity: AssistantActivityStatus | null
  /** Quinn's answer as it streams, before the persisted message lands (''=none). */
  assistantStream: string
  /** Post-conversation CSAT prompt / thanks. */
  showCsat: boolean
  /** Conversation status — drives the block-supersede-on-close rule. Optional
   *  (defaults to "not closed") so pre-existing fixtures that never cared
   *  about blocks don't all need updating. */
  conversationStatus?: ConversationStatus | null
  /** Reuse an already-computed scan instead of re-deriving it here — see
   *  derivePendingBlock's own doc for why. Omitted by every existing caller
   *  (tests, any one-off usage), which keeps computing it fresh. */
  blockStates?: Map<string, BlockState>
}

/**
 * Flatten the conversation thread into an ordered, stable-keyed row list for the
 * virtualizer: load-older → greeting → messages → seen → typing → csat. Pure so
 * the ordering/keying is unit-tested directly.
 */
export function buildConversationRows(input: ConversationRowsInput): ConversationRow[] {
  const rows: ConversationRow[] = []
  const blockStates =
    input.blockStates ?? computeBlockStates(input.messages, input.conversationStatus === 'closed')
  if (input.hasMoreOlder) rows.push({ type: 'load-older', key: 'load-older' })
  if (input.hasGreeting) rows.push({ type: 'greeting', key: 'greeting' })
  for (const message of input.messages) {
    // System events (e.g. "assigned to …") render as a centered notice, not a
    // bubble. An embedded post rides on contentJson and routes to a normal row.
    if (message.senderType === 'system') {
      rows.push({ type: 'system', key: message.id, message })
      continue
    }
    const blockState = blockStates.get(message.id as unknown as string)
    rows.push({ type: 'message', key: message.id, message, blockState })
  }
  if (input.showEmpty) rows.push({ type: 'empty', key: 'empty' })
  if (input.showSeen) rows.push({ type: 'seen', key: 'seen' })
  if (input.showTyping) rows.push({ type: 'typing', key: 'typing' })
  // Streamed answer supersedes the working trace once text arrives; both are
  // dropped the moment the persisted assistant message enters `messages`.
  if (input.assistantStream) {
    rows.push({ type: 'assistant-stream', key: 'assistant-stream', text: input.assistantStream })
  } else if (input.assistantActivity) {
    rows.push({
      type: 'assistant-activity',
      key: 'assistant-activity',
      status: input.assistantActivity,
    })
  }
  if (input.showCsat) rows.push({ type: 'csat', key: 'csat' })
  return rows
}
