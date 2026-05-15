import { commentMarkdownToTiptapJson } from '@/lib/server/markdown-tiptap'
import { RichTextContent } from '@/components/ui/rich-text-editor'
import { cn } from '@/lib/shared/utils'

interface CommentContentProps {
  content: string
  className?: string
}

// Cheap heuristic — returns true if `text` plausibly contains any markdown
// token we care about. False positives just take the slow path; false negatives
// would render markdown as plaintext, so the regex biases generous.
export function hasMarkdownTokens(text: string): boolean {
  if (!text) return false
  const blockRx = /(^|\n)(#{1,3} |[-*+] |\d+\. |> |```)/
  const inlineRx = /\*\*|__|~~|`[^`\n]/
  const linkRx = /\[[^\]\n]+\]\([^)\n]+\)/
  return blockRx.test(text) || inlineRx.test(text) || linkRx.test(text)
}

export function CommentContent({ content, className }: CommentContentProps) {
  if (!hasMarkdownTokens(content)) {
    return (
      <div className={className}>
        <p className="whitespace-pre-wrap">{content}</p>
      </div>
    )
  }
  const json = commentMarkdownToTiptapJson(content)
  return <RichTextContent content={json} className={cn(className)} />
}
