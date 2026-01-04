import { RichTextContent, isRichTextContent } from '@/components/ui/rich-text-editor'
import type { JSONContent } from '@tiptap/react'

interface PostContentProps {
  content: string
  contentJson?: unknown
  className?: string
}

export function PostContent({ content, contentJson, className }: PostContentProps) {
  // If we have valid TipTap JSON content, render it with the rich editor
  if (contentJson && isRichTextContent(contentJson)) {
    return <RichTextContent content={contentJson as JSONContent} className={className} />
  }

  // Fall back to plain text rendering
  return (
    <div className={className}>
      <p className="whitespace-pre-wrap">{content}</p>
    </div>
  )
}
