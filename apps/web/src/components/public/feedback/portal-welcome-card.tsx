import { memo } from 'react'
import { RichTextContent } from '@/components/ui/rich-text-content'
import { isEmptyTiptapDoc } from '@/lib/shared/utils/is-empty-tiptap-doc'
import { usePreviewEditMode } from '@/components/public/preview-draft-context'
import type { PortalWelcomeCard as PortalWelcomeCardData } from '@/lib/shared/types/settings'

interface PortalWelcomeCardProps {
  welcomeCard: PortalWelcomeCardData | undefined
}

function PortalWelcomeCardImpl({ welcomeCard }: PortalWelcomeCardProps) {
  // Set only in the Customise page's preview, where an empty message still
  // needs somewhere to click.
  const editLabels = usePreviewEditMode()
  if (!welcomeCard || isEmptyTiptapDoc(welcomeCard.body)) {
    if (!editLabels) return null
    return (
      <section
        data-qb-edit="welcome"
        className="mb-6 flex min-h-14 cursor-pointer items-center justify-center rounded-xl border border-dashed border-border text-sm text-muted-foreground"
      >
        {editLabels.welcome}
      </section>
    )
  }

  return (
    <section
      data-qb-edit="welcome"
      className="portal-card portal-welcome [--portal-card-edge:60%] [--portal-card-fill:60%] [--portal-card-rest-shadow:none] mb-6 rounded-xl border p-5 sm:p-6"
    >
      <RichTextContent content={welcomeCard.body} />
    </section>
  )
}

// Body rendering goes through DOMPurify.sanitize and TipTap's
// generateContentHTML, so memoize on the welcomeCard reference to keep
// the admin live-preview cheap on keystrokes.
export const PortalWelcomeCard = memo(PortalWelcomeCardImpl)
