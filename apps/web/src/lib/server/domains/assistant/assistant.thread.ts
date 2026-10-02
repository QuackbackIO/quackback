/**
 * Rows-to-turns mapper for the Quinn messenger wiring: conversation message DTOs
 * become the `AssistantThreadMessage[]` the runtime reasons over. Kept as a pure
 * mapper (unit-tested) plus a thin read-only loader over the shared
 * `listMessages` read.
 *
 * Sender mapping:
 *   - a 'visitor' message           → 'customer'
 *   - an 'agent' message by Quinn    → 'assistant' (matched on the service
 *                                      principal id)
 *   - an 'agent' message by anyone   → 'human_agent'
 * System notices are not turns and are skipped; text-less messages are skipped
 * UNLESS they carry image attachments (a screenshot-only customer message is a
 * turn — see vision.ts) or non-image attachments with a fileId (a document-only
 * customer message is a turn too — see the document-excerpt handling below).
 * Internal notes and soft-deleted rows are filtered in SQL, so they never reach
 * the mapper (and no longer consume window slots).
 *
 * Document excerpts: a customer attachment that is not an image and carries a
 * `fileId` gets a `[Attached file: name (Family)]` note folded into that
 * turn's `content`, immediately followed by the file's extracted excerpt when
 * one has been loaded (loadThreadFileExcerpts, one query per turn-building
 * read). A file with no excerpt yet (or ever) still gets its bracket line, so
 * Quinn knows the file exists even when it cannot read it. The bracket line
 * rides the same `content` field a customer's own typed text already does —
 * a customer message is already content to help with, never instructions to
 * follow — but the excerpt itself is text pulled from inside an uploaded
 * file, a notch further removed than the customer's own typed words, so it
 * gets its own fence: the same `wrapUntrustedText` guard every other surface
 * uses for text an end user or external system controls (injection-guard.ts).
 * Only customer (visitor) turns get this treatment; a human teammate's or
 * Quinn's own attachments are never expanded this way.
 *
 * Excerpt text is budgeted once across the WHOLE thread
 * (`THREAD_EXCERPT_BUDGET_CHARS`), spent newest-turn-first, so a long history
 * can never balloon the prompt the way an unbounded or per-turn-only cap
 * once could. Bracket lines are free and always included, whatever the
 * budget has left by the time a turn is reached.
 */
import type { PrincipalId, ConversationId, TicketId, FileId } from '@quackback/ids'
import {
  db,
  conversations,
  conversationMessages,
  tickets,
  ticketStatuses,
  eq,
  and,
  or,
  isNull,
  desc,
} from '@/lib/server/db'
import {
  listMessages,
  listConversationMessagesForGrounding,
} from '@/lib/server/domains/conversation/conversation.query'
import { resolvePairConversationId } from '@/lib/server/domains/tickets/pair-thread.service'
import type {
  ConversationMessageDTO,
  ConversationAttachment,
} from '@/lib/shared/conversation/types'
import { FAMILY_NAME, type FileFamily } from '@/lib/shared/files/file-types'
import type { FileExcerptRow } from '@/lib/server/domains/files/files.excerpts'
import { wrapUntrustedText } from './injection-guard'
import type { AssistantThreadMessage } from './assistant.runtime'

/** Newest recent turns to hand the model — enough context without unbounded prompt growth. */
export const ASSISTANT_THREAD_WINDOW = 40

/** Per-file excerpt cap, applied before the thread-wide budget below. */
const DOCUMENT_EXCERPT_CHAR_LIMIT = 4000

/**
 * Total excerpt TEXT across the whole thread (bracket lines are exempt and
 * always included). 40 turns of unbounded per-turn excerpts could reach
 * hundreds of thousands of characters; this caps the thread's documents at a
 * fixed, model-sized budget instead, spent on the newest turns first.
 */
const THREAD_EXCERPT_BUDGET_CHARS = 24000

const EMPTY_FILE_EXCERPTS: ReadonlyMap<string, FileExcerptRow> = new Map()

function isImageAttachment(a: ConversationAttachment): boolean {
  return a.contentType.startsWith('image/')
}

function isDocumentAttachment(a: ConversationAttachment): boolean {
  return !!a.fileId && !isImageAttachment(a)
}

/**
 * The bracket note for one attached document, plus its excerpt (truncated to
 * `DOCUMENT_EXCERPT_CHAR_LIMIT`) when the loaded row carries one.
 */
function documentNote(
  attachment: ConversationAttachment,
  row: FileExcerptRow | undefined
): { bracket: string; name: string; excerpt: string } {
  const family = (row?.family ?? attachment.family ?? 'other') as FileFamily
  const name = row?.name ?? attachment.name
  const bracket = `[Attached file: ${name} (${FAMILY_NAME[family] ?? 'File'})]`
  const excerpt = row?.textExcerpt?.trim() ?? ''
  return {
    bracket,
    name,
    excerpt:
      excerpt.length > DOCUMENT_EXCERPT_CHAR_LIMIT
        ? excerpt.slice(0, DOCUMENT_EXCERPT_CHAR_LIMIT)
        : excerpt,
  }
}

/**
 * Render every document attachment on one customer turn as bracket lines,
 * each immediately followed by its fenced excerpt (`wrapUntrustedText`) when
 * `budget` still has room for it. Every bracket line is always included;
 * excerpts are filled in, in order, until `budget` (this turn's share of the
 * thread-wide total, decided by the caller) runs out, so files early in the
 * list keep their excerpt over ones later on. Returns the rendered block
 * plus the excerpt characters it actually spent, for the caller to deduct
 * from the running thread-wide total.
 */
function documentsBlock(
  docs: ConversationAttachment[],
  fileExcerpts: ReadonlyMap<string, FileExcerptRow>,
  budget: number
): { block: string; used: number } {
  const notes = docs.map((a) => documentNote(a, fileExcerpts.get(a.fileId!)))
  const blocks = notes.map((n) => n.bracket)

  let used = 0
  let remaining = budget
  for (let i = 0; i < notes.length; i++) {
    const { excerpt, name } = notes[i]
    if (!excerpt || remaining <= 0) continue
    const kept = excerpt.length <= remaining ? excerpt : excerpt.slice(0, remaining)
    if (kept.length === 0) continue
    blocks[i] = `${blocks[i]}\n${wrapUntrustedText(`Excerpt of ${name}`, kept)}`
    used += kept.length
    remaining -= kept.length
  }

  return { block: blocks.join('\n\n'), used }
}

/**
 * Map conversation-message DTOs (oldest-first) to assistant thread turns.
 *
 * `fileExcerpts` is the result of `loadThreadFileExcerpts` over the same
 * `messages`, pre-loaded by the caller (a DB read, so it cannot live inside
 * this otherwise-pure mapper) — see the module doc for the document-excerpt
 * contract. Omit it for a cheap eligibility check that does not need excerpt
 * text: every document-bearing turn still counts and still carries its
 * bracket line, just without the extracted text.
 *
 * Excerpt text is allocated from `THREAD_EXCERPT_BUDGET_CHARS` in a second
 * pass over the turns already built, newest first, so the budget favors the
 * most recent attachments on a long thread rather than being exhausted by
 * whichever happened to come first.
 */
export function mapRowsToThreadMessages(
  messages: ConversationMessageDTO[],
  assistantPrincipalId: PrincipalId,
  fileExcerpts: ReadonlyMap<string, FileExcerptRow> = EMPTY_FILE_EXCERPTS
): AssistantThreadMessage[] {
  interface Draft {
    sender: 'customer' | 'assistant' | 'human_agent'
    trimmed: string
    images: ConversationAttachment[]
    documents: ConversationAttachment[]
    documentsText: string
  }

  const drafts: Draft[] = []
  for (const m of messages) {
    // System notices are status records, not turns.
    if (m.senderType === 'system') continue
    const trimmed = m.content?.trim() ?? ''
    // Image attachments make a text-less message a turn (Quinn vision) on any
    // sender, matching the pre-existing rule exactly. Document attachments
    // only ever do this for a customer turn (the only sender this expansion
    // ever applies to at all).
    const images = (m.attachments ?? []).filter(isImageAttachment)
    const documents =
      m.senderType === 'visitor' ? (m.attachments ?? []).filter(isDocumentAttachment) : []
    if (!trimmed && images.length === 0 && documents.length === 0) continue
    drafts.push({
      sender:
        m.senderType === 'visitor'
          ? 'customer'
          : m.author?.principalId === assistantPrincipalId
            ? 'assistant'
            : 'human_agent',
      trimmed,
      images,
      documents,
      documentsText: '',
    })
  }

  // Newest turn first: the most recent attachments keep their excerpt over
  // ones many turns back once the thread-wide budget runs out. A turn whose
  // share is zero still renders (documentsBlock always keeps its brackets).
  let remaining = THREAD_EXCERPT_BUDGET_CHARS
  for (let i = drafts.length - 1; i >= 0; i--) {
    const draft = drafts[i]
    if (draft.documents.length === 0) continue
    const { block, used } = documentsBlock(draft.documents, fileExcerpts, Math.max(0, remaining))
    draft.documentsText = block
    remaining -= used
  }

  return drafts.map((draft) => {
    const content = [draft.trimmed, draft.documentsText].filter(Boolean).join('\n\n')
    if (draft.sender === 'customer') {
      return {
        sender: 'customer' as const,
        content,
        ...(draft.images.length > 0 ? { attachments: draft.images } : {}),
      }
    }
    return { sender: draft.sender, content }
  })
}

/**
 * Collect the ids this turn-building read needs to resolve into excerpts, and
 * load them in one query. Returns an empty map (no query) when the thread has
 * no customer document attachments — the common case for most turns.
 */
export async function loadThreadFileExcerpts(
  messages: ConversationMessageDTO[]
): Promise<Map<string, FileExcerptRow>> {
  const ids = new Set<string>()
  for (const m of messages) {
    if (m.senderType !== 'visitor') continue
    for (const a of m.attachments ?? []) {
      if (isDocumentAttachment(a)) ids.add(a.fileId!)
    }
  }
  if (ids.size === 0) return new Map()
  const { loadFileExcerpts } = await import('@/lib/server/domains/files/files.excerpts')
  return loadFileExcerpts([...ids] as FileId[])
}

/**
 * Load a conversation's recent thread (oldest-first) as message DTOs. Internal
 * notes are excluded in SQL by default (`includeInternal: false`), so the window
 * is spent only on customer-visible turns — the byte-identical default every
 * existing caller (the summary paths, attribute classification, the
 * orchestrator) relies on. The copilot grounding block opts into
 * `includeInternal: true` so Quinn can see a teammate's notes on the open thread
 * (D1); no other caller passes it, and no non-team surface ever should. The
 * caller pairs these with the assistant principal id through
 * `mapRowsToThreadMessages` — the raw read is principal-independent, so it can
 * run in parallel with the principal lookup.
 *
 * `all: true` bypasses the newest-`ASSISTANT_THREAD_WINDOW` window and loads the
 * whole thread (oldest-first), for the copilot grounding block whose
 * `budgetTranscript` needs the thread head as well as its tail; the windowed
 * default would drop the customer's original request on a long conversation.
 * `limit` is ignored when `all` is set.
 */
export async function loadConversationThread(
  conversationId: ConversationId,
  opts: { limit?: number; includeInternal?: boolean; all?: boolean } = {}
): Promise<ConversationMessageDTO[]> {
  if (opts.all) {
    return listConversationMessagesForGrounding(conversationId, {
      includeInternal: opts.includeInternal ?? false,
    })
  }
  const { messages } = await listMessages(conversationId, {
    includeInternal: opts.includeInternal ?? false,
    limit: opts.limit ?? ASSISTANT_THREAD_WINDOW,
    preferAccountName: true,
  })
  return messages
}

/**
 * What a pre-turn gate needs to know about a conversation/ticket without
 * loading its thread (see `loadAssistantItemState`).
 */
export interface AssistantItemState {
  /**
   * Whether the item is closed: `conversations.status === 'closed'`, or the
   * ticket's status rolls up to the `'closed'` category (the coarse axis of
   * the two-axis ticket status model — see `ticketStatuses.category`).
   */
  closed: boolean
  /**
   * The item's latest customer-authored message id, or null when the item has
   * none: the newest `senderType: 'visitor'` row that is neither an internal
   * note nor soft-deleted, by (createdAt, id). For a ticket item this reads
   * the pair UNION (both parents when the ticket is conversation-linked) —
   * matching the union thread the client rendered and the orchestrator's own
   * union-loaded ticket grounding (assistant.runtime.ts). These filter
   * semantics are deliberately identical to the orchestrator's in-memory
   * equivalent over its already-loaded thread rows (assistant.orchestrator.ts,
   * the `latestCustomerMessageId` fold: `loadConversationThread` excludes
   * internal/deleted rows in SQL, then it takes the last 'visitor' row) —
   * change one and you must change the other.
   */
  latestCustomerMessageId: string | null
}

/**
 * Targeted pre-turn read for the suggest route's gates (staleness + closed
 * state), replacing a full thread load (messages + authors + attachments)
 * that was consumed for a single id — `runAssistantTurn` re-loads the thread
 * itself as grounding, so anything read here beyond these two facts is paid
 * for twice. Exactly one of `conversationId`/`ticketId` must be set (the
 * route's item ref guarantees it). Returns null when the item row does not
 * exist — defensive only; callers run behind an item-viewability gate.
 */
export async function loadAssistantItemState(
  conversationId: ConversationId | null,
  ticketId: TicketId | null
): Promise<AssistantItemState | null> {
  // CONVERGENCE PHASE 3: a ticket item that is conversation-linked shares ONE
  // thread with its pair, and the newest customer message can hang off EITHER
  // parent (post-1a requester replies land on the conversation). The staleness
  // id must be the union's latest — a ticket-parent-only read disagrees with
  // the union thread the client rendered (and with the orchestrator's own
  // union-loaded fold) and false-409s every suggest on a pair. An unlinked
  // ticket degenerates to the ticket parent alone.
  const pairConversationId = ticketId ? await resolvePairConversationId(ticketId) : null
  const latestCustomerMessageQuery = db
    .select({ id: conversationMessages.id })
    .from(conversationMessages)
    .where(
      and(
        conversationId
          ? eq(conversationMessages.conversationId, conversationId)
          : pairConversationId
            ? or(
                eq(conversationMessages.ticketId, ticketId as TicketId),
                eq(conversationMessages.conversationId, pairConversationId)
              )
            : eq(conversationMessages.ticketId, ticketId as TicketId),
        eq(conversationMessages.senderType, 'visitor'),
        eq(conversationMessages.isInternal, false),
        isNull(conversationMessages.deletedAt)
      )
    )
    .orderBy(desc(conversationMessages.createdAt), desc(conversationMessages.id))
    .limit(1)

  // Both branches project the one closed-determining value onto the same
  // `state` key: the conversation's own status, or the ticket status row's
  // coarse category.
  const closedQuery = conversationId
    ? db
        .select({ state: conversations.status })
        .from(conversations)
        .where(eq(conversations.id, conversationId))
        .limit(1)
    : db
        .select({ state: ticketStatuses.category })
        .from(tickets)
        .innerJoin(ticketStatuses, eq(ticketStatuses.id, tickets.statusId))
        .where(and(eq(tickets.id, ticketId as TicketId), isNull(tickets.deletedAt)))
        .limit(1)

  const [[itemRow], [messageRow]] = await Promise.all([closedQuery, latestCustomerMessageQuery])
  if (!itemRow) return null
  return { closed: itemRow.state === 'closed', latestCustomerMessageId: messageRow?.id ?? null }
}
