import { RichTextContent } from '@/components/ui/rich-text-content'
import { MentionHoverCardOverlay } from '@/components/ui/mention-hover-card-overlay'
import { EmbedHydration } from '@/components/shared/embed-hydration'
import { MessageMarkdown } from '@/components/shared/conversation/message-markdown'
import type { TiptapContent } from '@/lib/shared/db-types'

interface NoteContentProps {
  content: string
  /** TipTap doc for the note; when present we render mention chips + formatting
   *  the same way feedback comments do. Markdown-only notes use the shared
   *  conversation renderer. */
  contentJson?: TiptapContent | null
  className?: string
}

/**
 * Renders an internal note body. Mirrors public/comment-content so an
 * @-mention reads identically across feedback and conversations — a styled chip with a
 * hover card — instead of bare `@name` text.
 */
export function NoteContent({ content, contentJson, className }: NoteContentProps) {
  if (contentJson) {
    return (
      <MentionHoverCardOverlay>
        <EmbedHydration>
          <RichTextContent content={contentJson} className={className} />
        </EmbedHydration>
      </MentionHoverCardOverlay>
    )
  }
  return <MessageMarkdown text={content} className={className} />
}
