import { Suspense, lazy, useEffect, useMemo, useState } from 'react'
import { RichTextContent } from '@/components/ui/rich-text-content'
import { MentionHoverCardOverlay } from '@/components/ui/mention-hover-card-overlay'
import { EmbedHydration } from '@/components/shared/embed-hydration'
import { cn } from '@/lib/shared/utils'
import type { TiptapContent } from '@/lib/shared/db-types'

interface CommentContentProps {
  content: string
  /** Precomputed TipTap doc; when present we skip the markdown parse.
   * Legacy rows and optimistic-update cache entries omit this and fall
   * back to the markdown path. */
  contentJson?: TiptapContent | null
  className?: string
}

// False positives just take the slow path; false negatives would render
// markdown as plaintext, so this regex biases generous.
const BLOCK_RX = /(^|\n)(#{1,3} |[-*+] |\d+\. |> |```)/
const BOLD_RX = /\*\*|__/
const STRIKE_RX = /~~/
const INLINE_CODE_RX = /`[^`\n]/
const ITALIC_STAR_RX = /(?<![\w*])\*[^*\s][^*\n]*\*(?!\w)/
const ITALIC_UNDERSCORE_RX = /(?<![\w_])_[^_\s][^_\n]*_(?!\w)/
const LINK_RX = /\[[^\]\n]+\]\([^)\n]+\)/
const IMAGE_RX = /!\[[^\]]*\]\([^)\n]+\)/
const TABLE_RX = /(^|\n)\s*\|.+\|/

export function hasMarkdownTokens(text: string): boolean {
  if (!text) return false
  return (
    BLOCK_RX.test(text) ||
    BOLD_RX.test(text) ||
    STRIKE_RX.test(text) ||
    INLINE_CODE_RX.test(text) ||
    ITALIC_STAR_RX.test(text) ||
    ITALIC_UNDERSCORE_RX.test(text) ||
    LINK_RX.test(text) ||
    IMAGE_RX.test(text) ||
    TABLE_RX.test(text)
  )
}

/**
 * Parse a legacy comment's markdown into the TipTap doc newer rows store. The
 * parser brings tiptap, prosemirror and marked with it, more code than the rest
 * of a post page, so it loads on first use.
 */
function loadCommentMarkdownParser() {
  return import('@/lib/server/markdown-tiptap').then((m) => m.commentMarkdownToTiptapJson)
}

/**
 * A comment's TipTap doc: the stored one, or for a legacy row that has only
 * markdown, a parse of it made once `enabled`. Null while that parse is pending.
 */
export function useCommentDoc(
  content: string,
  contentJson: TiptapContent | null | undefined,
  enabled: boolean
): TiptapContent | null {
  const [parsed, setParsed] = useState<{ markdown: string; json: TiptapContent } | null>(null)
  const needsParse = enabled && !contentJson && parsed?.markdown !== content
  useEffect(() => {
    if (!needsParse) return
    let cancelled = false
    void loadCommentMarkdownParser().then((parse) => {
      if (!cancelled) setParsed({ markdown: content, json: parse(content) })
    })
    return () => {
      cancelled = true
    }
  }, [needsParse, content])
  if (contentJson) return contentJson
  return parsed?.markdown === content ? parsed.json : null
}

interface PlainCommentProps {
  content: string
  className?: string
}

const MarkdownComment = lazy(() =>
  loadCommentMarkdownParser().then((parse) => ({
    default: function MarkdownComment({ content, className }: PlainCommentProps) {
      const json = useMemo(() => parse(content), [content])
      return <RenderedComment json={json} className={className} />
    },
  }))
)

// Markdown-parsed docs never contain mention chips or embeds, but they render
// through the same wrappers so any future syntax routed through them is covered.
function RenderedComment({ json, className }: { json: TiptapContent; className?: string }) {
  return (
    <MentionHoverCardOverlay>
      <EmbedHydration>
        <RichTextContent content={json} className={className} />
      </EmbedHydration>
    </MentionHoverCardOverlay>
  )
}

function PlainComment({ content, className }: PlainCommentProps) {
  return <p className={cn('whitespace-pre-wrap', className)}>{content}</p>
}

export function CommentContent({ content, contentJson, className }: CommentContentProps) {
  if (contentJson) return <RenderedComment json={contentJson} className={className} />
  if (!hasMarkdownTokens(content)) return <PlainComment content={content} className={className} />
  // The raw text stands in while the parser loads; server rendering waits for it.
  return (
    <Suspense fallback={<PlainComment content={content} className={className} />}>
      <MarkdownComment content={content} className={className} />
    </Suspense>
  )
}
