import { memo } from 'react'
import { RichTextContent } from '@/components/ui/rich-text-content'
import { isEmptyTiptapDoc } from '@/lib/shared/utils/is-empty-tiptap-doc'
import type { PortalWelcomeCard as PortalWelcomeCardData } from '@/lib/shared/types/settings'

interface PortalWelcomeCardProps {
  welcomeCard: PortalWelcomeCardData | undefined
}

function PortalWelcomeCardImpl({ welcomeCard }: PortalWelcomeCardProps) {
  if (!welcomeCard || isEmptyTiptapDoc(welcomeCard.body)) return null

  return (
    <section className="mb-6 rounded-xl border border-border/60 bg-card/60 p-5 sm:p-6">
      <RichTextContent content={welcomeCard.body} />
    </section>
  )
}

// Body rendering goes through DOMPurify.sanitize and TipTap's
// generateContentHTML, so memoize on the welcomeCard reference to keep
// the admin live-preview cheap on keystrokes.
export const PortalWelcomeCard = memo(PortalWelcomeCardImpl)
