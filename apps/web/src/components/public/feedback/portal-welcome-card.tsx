import { memo } from 'react'
import { RichTextContent } from '@/components/ui/rich-text-content'
import { isEmptyTiptapDoc } from '@/lib/shared/utils/is-empty-tiptap-doc'
import { cn } from '@/lib/shared/utils'
import type { PortalWelcomeCard as PortalWelcomeCardData } from '@/lib/shared/types/settings'

interface PortalWelcomeCardProps {
  welcomeCard: PortalWelcomeCardData | undefined
}

function PortalWelcomeCardImpl({ welcomeCard }: PortalWelcomeCardProps) {
  if (!welcomeCard?.enabled) return null
  const trimmedTitle = welcomeCard.title.trim()
  const hasTitle = trimmedTitle.length > 0
  const hasBody = !isEmptyTiptapDoc(welcomeCard.body)
  if (!hasTitle && !hasBody) return null

  return (
    <section
      aria-labelledby={hasTitle ? 'portal-welcome-title' : undefined}
      className="mb-6 rounded-xl border border-border/60 bg-card/60 p-5 sm:p-6"
    >
      {hasTitle && (
        <h2 id="portal-welcome-title" className="text-xl sm:text-2xl font-semibold tracking-tight">
          {trimmedTitle}
        </h2>
      )}
      {hasBody && (
        <RichTextContent
          content={welcomeCard.body}
          className={cn(hasTitle && 'mt-2 text-muted-foreground')}
        />
      )}
    </section>
  )
}

// Body rendering goes through DOMPurify.sanitize and TipTap's
// generateContentHTML, so memoize on the welcomeCard reference to keep
// the admin live-preview cheap on title-only keystrokes.
export const PortalWelcomeCard = memo(PortalWelcomeCardImpl)
