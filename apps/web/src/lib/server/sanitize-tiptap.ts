/**
 * TipTap JSON Content Sanitizer
 *
 * Sanitizes TipTap JSON content at the server function layer (mutation time)
 * to prevent stored XSS. Validates node types against an allowlist and
 * coerces/sanitizes attributes per node type.
 *
 * This is Layer 1 of a two-layer defense:
 * - Layer 1 (here): JSON sanitization on write
 * - Layer 2: DOMPurify on HTML output at render time
 */

import { isValidTypeId } from '@quackback/ids'
import { sanitizeUrl, sanitizeImageUrl, safePositiveInt } from '@/lib/shared/utils/sanitize'
import { isTrustedAttachmentUrl } from '@/lib/server/storage/trusted-url'
import { ARTICLE_SLUG_RE } from '@/lib/shared/embeds/parse-embed-url'
import type { TiptapContent } from '@/lib/shared/schemas/posts'

// A flat width cap (paired with the depth cap) so a tampered client can't
// doc-bomb thousands of sibling nodes — generous enough for any real document.
const MAX_NODES = 5000

// Node types that match the TipTap editor extensions
const ALLOWED_NODE_TYPES = new Set([
  'doc',
  'paragraph',
  'heading',
  'text',
  'bulletList',
  'orderedList',
  'listItem',
  'taskList',
  'taskItem',
  'blockquote',
  'codeBlock',
  'image',
  'resizableImage',
  'youtube',
  'horizontalRule',
  'hardBreak',
  'table',
  'tableRow',
  'tableHeader',
  'tableCell',
  'emoji',
  'mention',
  'quackbackEmbed',
  'chatImage',
])

// Mark types that match the TipTap editor extensions
const ALLOWED_MARK_TYPES = new Set(['bold', 'italic', 'underline', 'strike', 'code', 'link'])

const VALID_HEADING_LEVELS = new Set([1, 2, 3, 4, 5, 6])

// Max 50 chars, only alphanumeric, hyphens, underscores, dots, plus
const LANGUAGE_PATTERN = /^[\w.+-]{0,50}$/

interface TiptapNode {
  type: string
  content?: TiptapNode[]
  text?: string
  marks?: TiptapMark[]
  attrs?: Record<string, unknown>
}

interface TiptapMark {
  type: string
  attrs?: Record<string, unknown>
}

/**
 * Sanitize a TipTap mark (bold, italic, link, etc.)
 */
function sanitizeMark(mark: TiptapMark): TiptapMark | null {
  if (!mark || typeof mark.type !== 'string') return null
  if (!ALLOWED_MARK_TYPES.has(mark.type)) return null

  if (mark.type === 'link') {
    const href = sanitizeUrl(String(mark.attrs?.href ?? ''))
    if (!href) return null
    return {
      type: 'link',
      attrs: {
        href,
        target: '_blank',
        rel: 'noopener noreferrer',
      },
    }
  }

  // Simple marks (bold, italic, etc.) need no attrs
  return { type: mark.type }
}

/**
 * Sanitize attributes for a specific node type.
 * Returns a clean attrs object with only safe, validated values.
 */
function sanitizeAttrs(
  type: string,
  attrs: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!attrs) return undefined

  switch (type) {
    case 'heading': {
      const rawLevel = Number(attrs.level)
      const level = VALID_HEADING_LEVELS.has(rawLevel) ? rawLevel : 2
      return { level }
    }

    case 'codeBlock': {
      const rawLang = String(attrs.language ?? '')
      const language = LANGUAGE_PATTERN.test(rawLang) ? rawLang : ''
      return { language }
    }

    case 'youtube': {
      const src = sanitizeUrl(String(attrs.src ?? ''))
      return {
        src,
        width: safePositiveInt(attrs.width, 640),
        height: safePositiveInt(attrs.height, 360),
      }
    }

    case 'image':
    case 'resizableImage': {
      const src = sanitizeImageUrl(String(attrs.src ?? ''))
      if (!src) return { src: '', alt: '' }
      const result: Record<string, unknown> = { src, alt: String(attrs.alt ?? '').slice(0, 500) }
      if (attrs.width !== undefined) result.width = safePositiveInt(attrs.width, 0)
      if (attrs.height !== undefined) result.height = safePositiveInt(attrs.height, 0)
      // Remove zero-value dimensions
      if (result.width === 0) delete result.width
      if (result.height === 0) delete result.height
      // `data-keep-ratio` (tiptap-extension-resizable-image) locks the aspect
      // ratio while a resize handle is dragged — a plain boolean, safe to coerce.
      if (attrs['data-keep-ratio'] !== undefined) {
        result['data-keep-ratio'] = Boolean(attrs['data-keep-ratio'])
      }
      return result
    }

    case 'chatImage': {
      // Inline conversation image. Unlike the post/comment `image` node, a conversation image
      // may ONLY point at our own upload pipeline (mirrors the attachment URL
      // guard) — a visitor must not be able to embed a third-party tracking
      // pixel that fires against an agent's browser. An untrusted/empty/unsafe
      // src clears both attrs so the serializer renders nothing.
      const rawSrc = String(attrs.src ?? '')
      if (!isTrustedAttachmentUrl(rawSrc)) return { src: '', alt: '' }
      const src = sanitizeImageUrl(rawSrc)
      if (!src) return { src: '', alt: '' }
      return { src, alt: String(attrs.alt ?? '').slice(0, 500) }
    }

    case 'taskItem':
      return { checked: Boolean(attrs.checked) }

    case 'emoji': {
      // Emoji nodes ship the shortcode (`name`) and the Unicode character.
      // Keep both as plain strings - everything else (HTML attrs, custom
      // payloads from gitHubCustomEmojis-style overrides) is dropped.
      const name = typeof attrs.name === 'string' ? attrs.name.slice(0, 64) : ''
      const emoji = typeof attrs.emoji === 'string' ? attrs.emoji.slice(0, 16) : ''
      const out: Record<string, unknown> = {}
      if (name) out.name = name
      if (emoji) out.emoji = emoji
      return Object.keys(out).length > 0 ? out : undefined
    }

    case 'orderedList':
      return attrs.start !== undefined
        ? { start: safePositiveInt(attrs.start, 1, 999999) }
        : undefined

    case 'mention': {
      // Mention nodes carry the target principal's TypeID (`id`) plus the
      // displayName the user saw when picking them (`label`). Anything else
      // (e.g. avatar URLs the client might send) is dropped — labels are
      // re-resolved against the live principal at render time.
      const id = typeof attrs.id === 'string' ? attrs.id.slice(0, 64) : ''
      const label = typeof attrs.label === 'string' ? attrs.label.slice(0, 200) : ''
      if (!id) return undefined
      return { id, label }
    }

    case 'quackbackEmbed': {
      // A Quackback link embed carries only `{ kind, id }`. `kind` must be one
      // of the embeddable entity types, and `id` must be valid for that kind:
      //   - post / changelog: a real TypeID (charset + round-trip verified)
      //   - article:          a help-center article slug (lowercase alphanumeric + hyphens)
      // Anything else strips attrs → the atom node survives but the serializer
      // renders nothing, so a malformed embed can never display.
      const kind = attrs.kind
      const id = typeof attrs.id === 'string' ? attrs.id : ''
      if (kind === 'article') {
        // Article public URLs are slug-based; validate the slug charset rather
        // than a TypeID, since no TypeID appears in the public help-center URL.
        if (!ARTICLE_SLUG_RE.test(id)) return undefined
        return { kind, id }
      }
      if ((kind !== 'post' && kind !== 'changelog') || !isValidTypeId(id, kind)) {
        return undefined
      }
      return { kind, id }
    }

    // Nodes with no meaningful attrs to sanitize
    case 'doc':
    case 'paragraph':
    case 'text':
    case 'bulletList':
    case 'listItem':
    case 'taskList':
    case 'blockquote':
    case 'horizontalRule':
    case 'hardBreak':
    case 'table':
    case 'tableRow':
    case 'tableHeader':
    case 'tableCell':
      return undefined

    default:
      return undefined
  }
}

/**
 * Recursively sanitize a TipTap JSON node tree.
 * - Strips unknown node types
 * - Validates and coerces attributes per node type
 * - Sanitizes marks (bold, italic, link, etc.)
 * - Sanitizes URLs in links and images
 */
function sanitizeNode(
  node: TiptapNode,
  depth = 0,
  // Shared mutable counter (created once at the top call, threaded through the
  // recursion) bounding total node count across the whole tree.
  budget: { count: number } = { count: 0 }
): TiptapNode | null {
  // Prevent deeply nested content (potential DoS or stack overflow)
  if (depth > 20) return null
  // Prevent a flat doc-bomb of thousands of sibling nodes.
  if (++budget.count > MAX_NODES) return null

  if (!node || typeof node.type !== 'string') return null

  // Strip unknown node types
  if (!ALLOWED_NODE_TYPES.has(node.type)) return null

  const sanitized: TiptapNode = { type: node.type }

  // Sanitize text content
  if (node.type === 'text') {
    if (typeof node.text !== 'string') return null
    sanitized.text = node.text
  }

  // Sanitize attributes
  const attrs = sanitizeAttrs(node.type, node.attrs)
  if (attrs !== undefined) {
    sanitized.attrs = attrs
  }

  // Sanitize marks (only on text nodes)
  if (node.marks && Array.isArray(node.marks)) {
    const sanitizedMarks = node.marks.map(sanitizeMark).filter((m): m is TiptapMark => m !== null)
    if (sanitizedMarks.length > 0) {
      sanitized.marks = sanitizedMarks
    }
  }

  // Recursively sanitize child content
  if (node.content && Array.isArray(node.content)) {
    const sanitizedContent = node.content
      .map((child) => sanitizeNode(child, depth + 1, budget))
      .filter((child): child is TiptapNode => child !== null)
    if (sanitizedContent.length > 0) {
      sanitized.content = sanitizedContent
    }
  }

  return sanitized
}

/**
 * Sanitize TipTap JSON content for safe storage.
 *
 * Call this in server functions before passing contentJson to services.
 * Strips unknown node types and validates/coerces all attributes.
 *
 * @param content - Raw TipTap JSON from client
 * @returns Sanitized TipTap JSON safe for storage and rendering
 */
export function sanitizeTiptapContent(content: {
  type: string
  content?: unknown[]
}): TiptapContent {
  const sanitized = sanitizeNode(content as TiptapNode)
  if (!sanitized || sanitized.type !== 'doc') {
    return { type: 'doc' } as TiptapContent
  }
  return sanitized as TiptapContent
}
