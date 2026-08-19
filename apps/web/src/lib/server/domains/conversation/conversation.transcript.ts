/**
 * Renders a conversation to a plain-text/markdown transcript for agent export
 * (records, compliance, handoff). Pure and deterministic — timestamps format in
 * UTC so the output never depends on the server's locale or timezone. Internal
 * notes are included; callers pass an agent-scoped message list.
 */
import type { ConversationMessageDTO, MessageSenderType } from '@/lib/shared/conversation/types'
import type { TiptapContent } from '@/lib/server/db'
import { tiptapJsonToText } from '@/lib/server/markdown-tiptap'

export interface TranscriptMeta {
  id: string
  /** Header title; defaults to `Conversation {id}`. Tickets pass `Ticket #142`. */
  heading?: string
  subject?: string | null
  status?: string | null
  channel?: string | null
  createdAt?: string | Date | null
}

/** The DTO subset the renderer reads; a ConversationMessageDTO satisfies it. */
export type TranscriptMessage = Pick<
  ConversationMessageDTO,
  | 'senderType'
  | 'content'
  | 'contentJson'
  | 'createdAt'
  | 'author'
  | 'isInternal'
  | 'isAssistant'
  | 'attachments'
>

/** `2026-07-04T09:15:30.000Z` -> `2026-07-04 09:15 UTC`; timezone-free so tests
 *  and exports are deterministic regardless of server locale. */
function fmtUtc(value: string | Date | null | undefined): string {
  if (!value) return 'unknown'
  const iso = typeof value === 'string' ? value : value.toISOString()
  const m = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})/.exec(iso)
  return m ? `${m[1]} ${m[2]} UTC` : iso
}

function defaultName(senderType: MessageSenderType, isAssistant: boolean): string {
  if (senderType === 'visitor') return 'Visitor'
  if (isAssistant) return 'Assistant'
  return 'Agent'
}

/** "Jane (agent)", "Quinn (assistant)", "Jane (agent) · internal note", "System". */
function speaker(m: TranscriptMessage): string {
  if (m.senderType === 'system') return 'System'
  const roleLabel = m.senderType === 'visitor' ? 'visitor' : m.isAssistant ? 'assistant' : 'agent'
  const name = m.author?.displayName?.trim() || defaultName(m.senderType, m.isAssistant)
  return `${name} (${roleLabel})${m.isInternal ? ' · internal note' : ''}`
}

/** The message line's text: the plain `content` mirror when present, else a
 *  plaintext walk of `contentJson` (blank `content` alongside a rich doc —
 *  e.g. a rich-composer message that's image-only, or whose client only
 *  serialized `contentJson`). Empty when the message has neither. */
function messageText(m: TranscriptMessage): string {
  const trimmed = m.content?.trim()
  if (trimmed) return trimmed
  return m.contentJson ? tiptapJsonToText(m.contentJson) : ''
}

/** Image node types a rich message may embed. Mirrors the set
 *  `tiptapJsonToText` renders as a generic `[image]` placeholder. */
const TRANSCRIPT_IMAGE_NODE_TYPES = new Set(['chatImage', 'image', 'resizableImage'])

/**
 * Depth-first collection of every image node's `src` in a `contentJson` doc,
 * in document order. `tiptapJsonToText` already stands in a generic `[image]`
 * placeholder for each one inline — this doesn't change that shared behavior
 * (other callers rely on it) — so the transcript separately lists the actual
 * URLs, one per line, after the message text.
 */
function imageSources(json: TiptapContent | null | undefined): string[] {
  if (!json) return []
  const out: string[] = []
  const visit = (node: TiptapContent): void => {
    const src = node.attrs?.src
    if (TRANSCRIPT_IMAGE_NODE_TYPES.has(node.type) && typeof src === 'string' && src) {
      out.push(src)
    }
    for (const child of node.content ?? []) visit(child)
  }
  visit(json)
  return out
}

export function renderConversationTranscript(
  meta: TranscriptMeta,
  messages: TranscriptMessage[]
): string {
  const lines: string[] = [`# ${meta.heading ?? `Conversation ${meta.id}`}`, '']
  if (meta.subject?.trim()) lines.push(`- Subject: ${meta.subject.trim()}`)
  if (meta.status) lines.push(`- Status: ${meta.status}`)
  if (meta.channel) lines.push(`- Channel: ${meta.channel}`)
  lines.push(`- Opened: ${fmtUtc(meta.createdAt)}`)
  lines.push(`- Messages: ${messages.length}`)
  lines.push('', '---', '')

  if (messages.length === 0) lines.push('_No messages._')
  for (const m of messages) {
    const text = messageText(m)
    lines.push(`[${fmtUtc(m.createdAt)}] ${speaker(m)}: ${text || '(no text content)'}`)
    for (const src of imageSources(m.contentJson)) {
      lines.push(`[image] ${src}`)
    }
    for (const a of m.attachments ?? []) {
      lines.push(`    - attachment: ${a.name || a.url}`)
    }
  }
  return lines.join('\n') + '\n'
}
