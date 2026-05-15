import { commentMarkdownToTiptapJson } from '@/lib/server/markdown-tiptap'
import { RichTextContent } from '@/components/ui/rich-text-editor'

interface CommentContentProps {
  content: string
  className?: string
}

// False positives just take the slow path; false negatives would render
// markdown as plaintext, so this regex biases generous.
export function hasMarkdownTokens(text: string): boolean {
  if (!text) return false
  const blockRx = /(^|\n)(#{1,3} |[-*+] |\d+\. |> |```)/
  const inlineRx =
    /\*\*|__|~~|`[^`\n]|(?<![\w*])\*[^*\s][^*\n]*\*(?!\w)|(?<![\w_])_[^_\s][^_\n]*_(?!\w)/
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
  return <RichTextContent content={json} className={className} />
}
