import { RichTextContent } from '@/components/ui/rich-text-editor'
import { MentionHoverCardOverlay } from '@/components/ui/mention-hover-card-overlay'
import { EmbedHydration } from '@/components/shared/embed-hydration'
import { cn } from '@/lib/shared/utils'
import type { TiptapContent } from '@/lib/shared/db-types'

interface NoteContentProps {
  content: string
  /** TipTap doc for the note; when present we render mention chips + formatting
   *  the same way feedback comments do. Plain notes (and legacy rows) fall back
   *  to whitespace-preserving text. */
  contentJson?: TiptapContent | null
  className?: string
}

/**
 * Renders an internal note body. Mirrors public/comment-content so an
 * @-mention reads identically across feedback and chat — a styled chip with a
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
  return <p className={cn('whitespace-pre-wrap break-words', className)}>{content}</p>
}
