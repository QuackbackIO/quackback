import { RichTextContent, isRichTextContent } from '@/components/ui/rich-text-content'
import { MentionHoverCardOverlay } from '@/components/ui/mention-hover-card-overlay'
import { EmbedHydration } from '@/components/shared/embed-hydration'
import type { JSONContent } from '@tiptap/react'

interface PostContentProps {
  content: string
  contentJson?: unknown
  className?: string
}

export function PostContent({ content, contentJson, className }: PostContentProps) {
  // If we have valid TipTap JSON content, render it with the rich editor.
  // The mention overlay wraps the rendered HTML so any `.mention` chip
  // inside picks up the hover-card behaviour via event delegation.
  if (contentJson && isRichTextContent(contentJson)) {
    return (
      <MentionHoverCardOverlay>
        <EmbedHydration>
          <RichTextContent content={contentJson as JSONContent} className={className} />
        </EmbedHydration>
      </MentionHoverCardOverlay>
    )
  }

  // Fall back to plain text rendering — no mention chips to hydrate here.
  return (
    <div className={className}>
      <p className="whitespace-pre-wrap">{content}</p>
    </div>
  )
}
