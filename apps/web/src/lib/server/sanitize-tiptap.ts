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

import { sanitizeUrl, sanitizeImageUrl, safePositiveInt } from '@/lib/shared/utils/sanitize'
import type { TiptapContent } from '@/lib/shared/schemas/posts'

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
      return result
    }

    case 'taskItem':
      return { checked: Boolean(attrs.checked) }

    case 'orderedList':
      return attrs.start !== undefined
        ? { start: safePositiveInt(attrs.start, 1, 999999) }
        : undefined

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
function sanitizeNode(node: TiptapNode, depth = 0): TiptapNode | null {
  // Prevent deeply nested content (potential DoS or stack overflow)
  if (depth > 20) return null

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
      .map((child) => sanitizeNode(child, depth + 1))
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
