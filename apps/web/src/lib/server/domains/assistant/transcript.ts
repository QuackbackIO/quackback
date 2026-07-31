/**
 * Shared transcript rendering + budgeting for Quinn's grounding and summary
 * paths. A thread (oldest-first) renders to plain "Speaker: content" lines; a
 * rendered transcript can then be bounded to a char budget with a head+tail
 * window so a long thread never silently loses its opening messages.
 *
 * One definition, two consumers:
 *   - `assistant.runtime.ts` — the copilot turn's ticket AND conversation
 *     grounding blocks (`buildTicketTranscript` / `buildConversationTranscript`,
 *     each then passed through `budgetTranscript`).
 *   - `conversation-summary.service.ts` — the on-close summary and the on-demand
 *     Summarize chip (conversation via `buildConversationTranscript`, ticket via
 *     `buildTicketTranscript`).
 *
 * The two renderers are intentionally byte-identical (a conversation message and
 * a ticket message are the same `ConversationMessageDTO` shape); they stay
 * separately named so each call site reads for what it grounds on.
 *
 * Internal-note labelling (copilot grounding, D1): an internal note is labelled
 * `Note (internal):` rather than `Agent:` so the model can tell a teammate-only
 * note from a customer-visible message. A note only ever reaches these renderers
 * when the caller loaded the thread with `includeInternal` — the copilot
 * grounding block does; the summary paths load notes-free, so the label branch
 * never fires there and a note can never leak into a persisted summary.
 */
import type { ConversationMessageDTO } from '@/lib/shared/conversation/types'

/**
 * Max chars of rendered transcript injected as grounding, and the cap the
 * summary paths slice to. One shared value so grounding and the summarizer
 * bound the thread the same way.
 */
export const GROUNDING_CHAR_BUDGET = 6000

/** The marker `budgetTranscript` inserts between the kept head and tail windows. */
export const OMITTED_MESSAGES_MARKER = '\n\n[... earlier messages omitted ...]\n\n'

/**
 * Render a thread (oldest-first) as plain "Speaker: content" lines. A 'system'
 * message (e.g. a status-change notice) is bookkeeping, not something either
 * party said, so it never belongs in the rendered thread; text-less messages
 * carry nothing for the model UNLESS they hold image attachments — those
 * render as a `[image attached: name]` note so the model knows a screenshot
 * exists (the live image stream, gated on model capability, is vision.ts's
 * job; this text note is the always-on fallback). An internal note is
 * labelled `Note (internal):` (see the module doc on D1).
 */
function renderTranscript(messages: ConversationMessageDTO[]): string {
  const lines: string[] = []
  for (const m of messages) {
    if (m.senderType === 'system') continue
    const content = m.content?.trim()
    const imageNames = (m.attachments ?? [])
      .filter((a) => a.contentType.startsWith('image/'))
      .map((a) => a.name)
    const imageNote = imageNames.length > 0 ? `[image attached: ${imageNames.join(', ')}]` : ''
    if (!content && !imageNote) continue
    const speaker = m.isInternal
      ? 'Note (internal)'
      : m.senderType === 'visitor'
        ? 'Customer'
        : 'Agent'
    lines.push(`${speaker}: ${[content, imageNote].filter(Boolean).join(' ')}`)
  }
  return lines.join('\n')
}

/** Render a ticket thread as grounding/summary lines (see `renderTranscript`). */
export function buildTicketTranscript(messages: ConversationMessageDTO[]): string {
  return renderTranscript(messages)
}

/** Render a conversation thread as grounding/summary lines (see `renderTranscript`). */
export function buildConversationTranscript(messages: ConversationMessageDTO[]): string {
  return renderTranscript(messages)
}

/**
 * Bound a rendered transcript to `budget` chars. Under budget, it's returned
 * verbatim. Over budget, keep a head window (the opening messages that state the
 * problem) plus a tail window (the most recent messages that state where things
 * stand). When whole messages fall between the two windows, they're replaced by
 * `OMITTED_MESSAGES_MARKER` so the model knows the thread was trimmed and never
 * loses the original request; when the two windows meet with nothing between
 * them, no marker is emitted (nothing was actually omitted). Windows grow by
 * whole lines, but a single line larger than its window is hard-truncated so the
 * total always honors `budget` (a lone giant message can't blow the cap).
 */
export function budgetTranscript(
  transcript: string,
  budget: number = GROUNDING_CHAR_BUDGET
): string {
  if (transcript.length <= budget) return transcript

  const lines = transcript.split('\n')
  const room = Math.max(0, budget - OMITTED_MESSAGES_MARKER.length)
  const headBudget = Math.floor(room / 2)
  const tailBudget = room - headBudget

  // Head: take from the start; always include the first line (the original
  // request), then keep adding whole lines until the next would overflow.
  const head: string[] = []
  let headLen = 0
  let headEnd = 0 // first line index NOT in the head window
  for (const line of lines) {
    const add = head.length === 0 ? line.length : line.length + 1 // +1 for the joining '\n'
    if (head.length > 0 && headLen + add > headBudget) break
    head.push(line)
    headLen += add
    headEnd++
  }

  // Tail: take from the end back toward (but never crossing into) the head;
  // always include the last line.
  const tail: string[] = []
  let tailLen = 0
  let tailStart = lines.length // first line index IN the tail window
  for (let i = lines.length - 1; i >= headEnd; i--) {
    const line = lines[i]
    const add = tail.length === 0 ? line.length : line.length + 1
    if (tail.length > 0 && tailLen + add > tailBudget) break
    tail.unshift(line)
    tailLen += add
    tailStart = i
  }

  // Hard-cap each window so a lone line bigger than its budget can't overflow:
  // head keeps its opening chars, tail keeps its most-recent chars.
  const headStr = capEnd(head.join('\n'), headBudget)
  const tailStr = capStart(tail.join('\n'), tailBudget)

  // Anything left in [headEnd, tailStart) is a whole-message gap; only then is
  // the marker truthful. When the windows meet (tailStart <= headEnd) nothing
  // was dropped, so join directly.
  if (tailStart <= headEnd) {
    return [headStr, tailStr].filter(Boolean).join('\n')
  }
  return `${headStr}${OMITTED_MESSAGES_MARKER}${tailStr}`
}

/** Keep the first `max` chars (the opening of an oversized head window). */
function capEnd(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max)
}

/** Keep the last `max` chars (the most recent content of an oversized tail window). */
function capStart(s: string, max: number): string {
  return s.length <= max ? s : s.slice(s.length - max)
}
