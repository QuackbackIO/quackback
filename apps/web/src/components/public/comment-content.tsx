import { useMemo } from 'react'
import { commentMarkdownToTiptapJson } from '@/lib/server/markdown-tiptap'
import { RichTextContent } from '@/components/ui/rich-text-editor'
import { cn } from '@/lib/shared/utils'

interface CommentContentProps {
  content: string
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

export function CommentContent({ content, className }: CommentContentProps) {
  const isMarkdown = hasMarkdownTokens(content)
  const json = useMemo(
    // isMarkdown is derived synchronously from content

    () => (isMarkdown ? commentMarkdownToTiptapJson(content) : null),
    [content]
  )
  if (!isMarkdown || !json) {
    return <p className={cn('whitespace-pre-wrap', className)}>{content}</p>
  }
  return <RichTextContent content={json} className={className} />
}
