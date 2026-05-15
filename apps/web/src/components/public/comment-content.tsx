import { useMemo } from 'react'
import { commentMarkdownToTiptapJson } from '@/lib/server/markdown-tiptap'
import { RichTextContent } from '@/components/ui/rich-text-editor'
import { MentionHoverCardOverlay } from '@/components/ui/mention-hover-card-overlay'
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

export function hasMarkdownTokens(text: string): boolean {
  if (!text) return false
  return (
    BLOCK_RX.test(text) ||
    BOLD_RX.test(text) ||
    STRIKE_RX.test(text) ||
    INLINE_CODE_RX.test(text) ||
    ITALIC_STAR_RX.test(text) ||
    ITALIC_UNDERSCORE_RX.test(text) ||
    LINK_RX.test(text)
  )
}

export function CommentContent({ content, contentJson, className }: CommentContentProps) {
  const isMarkdown = hasMarkdownTokens(content)
  // Only parse markdown when there's no precomputed JSON to fall back on.
  const fallbackJson = useMemo(
    () => (!contentJson && isMarkdown ? commentMarkdownToTiptapJson(content) : null),
    [content, contentJson, isMarkdown]
  )
  if (contentJson) {
    return (
      <MentionHoverCardOverlay>
        <RichTextContent content={contentJson} className={className} />
      </MentionHoverCardOverlay>
    )
  }
  if (!isMarkdown || !fallbackJson) {
    return <p className={cn('whitespace-pre-wrap', className)}>{content}</p>
  }
  // Markdown fallback never contains mention chips, but wrap anyway so any
  // future mention syntax routed through this path is covered.
  return (
    <MentionHoverCardOverlay>
      <RichTextContent content={fallbackJson} className={className} />
    </MentionHoverCardOverlay>
  )
}
