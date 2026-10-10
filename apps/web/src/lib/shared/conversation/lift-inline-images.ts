/**
 * Read-time lift of legacy inline conversation images into `attachments[]`.
 *
 * Admin paste used to author `resizableImage` / `image` / `chatImage` nodes
 * inside `contentJson`. Those now display as tray attachments. Stored rows
 * are not rewritten — this helper is applied when mapping a row to a DTO so
 * every surface uses ConversationAttachmentList.
 */
import type { ConversationAttachment } from '@/lib/shared/conversation/types'
import { MAX_CONVERSATION_ATTACHMENTS } from '@/lib/shared/conversation/types'
import type { TiptapContent } from '@/lib/shared/db-types'
import { sanitizeImageUrl } from '@/lib/shared/utils/sanitize'

const INLINE_IMAGE_TYPES = new Set(['image', 'resizableImage', 'chatImage'])

function guessContentType(url: string): string {
  const path = url.split('?')[0]?.toLowerCase() ?? ''
  if (path.endsWith('.png')) return 'image/png'
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg'
  if (path.endsWith('.gif')) return 'image/gif'
  if (path.endsWith('.webp')) return 'image/webp'
  if (path.endsWith('.avif')) return 'image/avif'
  return 'image/*'
}

function attachmentName(src: string, alt?: unknown): string {
  if (typeof alt === 'string' && alt.trim()) return alt.trim().slice(0, 255)
  try {
    const path = new URL(src, 'https://example.invalid').pathname
    const base = decodeURIComponent(path.split('/').pop() || '')
    return (base || 'image').slice(0, 255)
  } catch {
    return 'image'
  }
}

function toAttachment(src: string, alt?: unknown): ConversationAttachment {
  return {
    url: src,
    name: attachmentName(src, alt),
    contentType: guessContentType(src),
    size: 0,
  }
}

/** Strip image nodes and collect displayable srcs. Returns null to drop the node. */
function stripImages(
  node: TiptapContent,
  collected: ConversationAttachment[],
  seen: Set<string>,
  slotsLeft: number
): TiptapContent | null {
  if (INLINE_IMAGE_TYPES.has(node.type)) {
    const raw = typeof node.attrs?.src === 'string' ? node.attrs.src : ''
    const src = sanitizeImageUrl(raw)
    if (src && !seen.has(src) && collected.length < slotsLeft) {
      seen.add(src)
      collected.push(toAttachment(src, node.attrs?.alt))
    }
    return null
  }
  if (!node.content?.length) return node
  const next = node.content
    .map((child) => stripImages(child, collected, seen, slotsLeft))
    .filter((child): child is TiptapContent => child != null)
  return next.length === node.content.length && next.every((c, i) => c === node.content![i])
    ? node
    : { ...node, content: next }
}

/**
 * Move inline image nodes onto `attachments` and remove them from the doc.
 * Dedupes by URL. Caps at {@link MAX_CONVERSATION_ATTACHMENTS}. Returns the
 * original `attachments` / `contentJson` references when nothing is lifted.
 */
export function liftInlineImagesToAttachments(
  contentJson: TiptapContent | null | undefined,
  attachments: ConversationAttachment[]
): { contentJson: TiptapContent | null; attachments: ConversationAttachment[] } {
  if (!contentJson) return { contentJson: null, attachments }
  const lifted: ConversationAttachment[] = []
  const seen = new Set(attachments.map((a) => a.url))
  const slotsLeft = Math.max(0, MAX_CONVERSATION_ATTACHMENTS - attachments.length)
  const stripped = stripImages(contentJson, lifted, seen, slotsLeft)
  if (lifted.length === 0 && stripped === contentJson) {
    return { contentJson, attachments }
  }
  return {
    contentJson: stripped,
    attachments: lifted.length === 0 ? attachments : [...attachments, ...lifted],
  }
}
