/**
 * Read-only rich-text renderer — the display half of the editor, split out so
 * portal reading surfaces (posts, comments, changelog, help-center articles,
 * conversation bubbles) never pull in the full TipTap/ProseMirror editor chunk.
 *
 * This module imports ONLY light dependencies: the browser-free JSON→HTML
 * serializer (`@/lib/shared/content-html`), DOMPurify, and `cn`. It never touches
 * tiptap, prosemirror, lowlight, or the emoji dataset. The heavy emoji dataset is
 * pulled in lazily, and only when a legacy `name`-only emoji node is actually
 * present (see the emoji upgrade below).
 *
 * `rich-text-editor.tsx` re-exports these for backward compatibility, but every
 * read-only consumer imports from here directly so the compat re-export doesn't
 * drag the editor chunk into reader bundles.
 */
import { useEffect, useMemo, useState } from 'react'
import type { JSONContent } from '@tiptap/core'
import DOMPurify from 'dompurify'
import { cn } from '@/lib/shared/utils'
import { generateContentHTML } from '@/lib/shared/content-html'

interface RichTextContentProps {
  content: JSONContent | string
  className?: string
}

// DOMPurify config for sanitizing rendered TipTap HTML (defense-in-depth)
const DOMPURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'p',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'strong',
    'em',
    'u',
    's',
    'code',
    'pre',
    'a',
    'ul',
    'ol',
    'li',
    'blockquote',
    'hr',
    'br',
    'img',
    'iframe',
    'div',
    'table',
    'tr',
    'th',
    'td',
    'input',
    'span',
  ],
  ALLOWED_ATTR: [
    'id',
    'href',
    'src',
    'alt',
    'class',
    'style',
    'target',
    'rel',
    'width',
    'height',
    'frameborder',
    'allow',
    'allowfullscreen',
    'type',
    'checked',
    'disabled',
    'data-type',
    'data-name',
    'data-principal-id',
    'data-display-name',
    'data-quackback-embed',
    'data-kind',
    'data-id',
  ],
  ALLOW_DATA_ATTR: false,
  ADD_TAGS: ['iframe'],
  ADD_ATTR: ['allowfullscreen', 'frameborder', 'allow'],
}

/**
 * Collect the shortcodes of any emoji node that stored only a `name` (no Unicode
 * char). These are the legacy nodes `generateContentHTML` renders as a
 * `:shortcode:` placeholder; the client upgrades them on demand.
 */
function collectLegacyEmojiNames(node: JSONContent, out: Set<string>): void {
  if (!node) return
  if (node.type === 'emoji') {
    const name = node.attrs?.name
    if (typeof name === 'string' && name && !node.attrs?.emoji) out.add(name)
  }
  if (Array.isArray(node.content)) {
    for (const child of node.content) collectLegacyEmojiNames(child, out)
  }
}

/**
 * Resolve legacy `name`-only emoji shortcodes to Unicode chars via an on-demand
 * dynamic import of the emoji dataset. Returns null until (and unless) there is
 * work to do and the dataset has loaded, so read-only chunks never statically
 * bundle the ~700 KB dataset. The picker stores the char in `attrs.emoji`, so
 * real content almost never trips this path.
 */
function useLegacyEmojiChars(content: JSONContent | string): Record<string, string> | null {
  const legacyNames = useMemo(() => {
    if (typeof content !== 'object' || content?.type !== 'doc') return [] as string[]
    const names = new Set<string>()
    collectLegacyEmojiNames(content, names)
    return Array.from(names)
  }, [content])

  const [chars, setChars] = useState<Record<string, string> | null>(null)

  useEffect(() => {
    if (legacyNames.length === 0) {
      setChars(null)
      return
    }
    let cancelled = false
    void import('@/lib/shared/content-emoji').then(({ lookupEmoji }) => {
      if (cancelled) return
      const resolved: Record<string, string> = {}
      for (const name of legacyNames) {
        const ch = lookupEmoji(name)?.emoji
        if (ch) resolved[name] = ch
      }
      setChars(Object.keys(resolved).length > 0 ? resolved : null)
    })
    return () => {
      cancelled = true
    }
  }, [legacyNames])

  return chars
}

export function RichTextContent({ content, className }: RichTextContentProps) {
  const legacyEmojiChars = useLegacyEmojiChars(content)

  // Generate HTML from JSON content, with DOMPurify defense-in-depth on client
  if (typeof content === 'object' && content.type === 'doc') {
    let rawHtml = generateContentHTML(content)
    // Swap resolved legacy `:shortcode:` placeholders for their Unicode char.
    // Only runs after the on-demand dataset import resolves for content that
    // actually contains a `name`-only emoji node.
    if (legacyEmojiChars) {
      for (const [name, ch] of Object.entries(legacyEmojiChars)) {
        const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        rawHtml = rawHtml.replace(
          new RegExp(
            `(<span data-type="emoji" data-name="${escapedName}">):${escapedName}:(</span>)`,
            'g'
          ),
          `$1${ch}$2`
        )
      }
    }
    // DOMPurify requires a DOM — on the server, generateContentHTML already produces
    // controlled HTML from validated JSON (content is sanitized at ingestion time)
    // DOMPurify deliberately refuses unsupported DOM implementations. Happy
    // DOM is used only by unit tests; production browsers still sanitize.
    const canSanitize = typeof window !== 'undefined' && !('happyDOM' in window)
    const html = canSanitize ? DOMPurify.sanitize(rawHtml, DOMPURIFY_CONFIG) : rawHtml
    return (
      <div
        className={cn('prose prose-neutral dark:prose-invert max-w-none', className)}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    )
  }

  // For string content (HTML or plain text)
  if (typeof content === 'string') {
    return (
      <div className={cn('prose prose-neutral dark:prose-invert max-w-none', className)}>
        <p className="whitespace-pre-wrap">{content}</p>
      </div>
    )
  }

  return null
}

// Helper to check if content is TipTap JSON
export function isRichTextContent(content: unknown): content is JSONContent {
  return (
    typeof content === 'object' &&
    content !== null &&
    'type' in content &&
    (content as JSONContent).type === 'doc'
  )
}
