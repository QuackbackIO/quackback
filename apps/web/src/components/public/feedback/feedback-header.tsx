import { lazy, Suspense } from 'react'
import { useIntl } from 'react-intl'
import { useFeedCopy } from '@/components/public/preview-draft-context'
import { PencilIcon } from '@heroicons/react/24/solid'
import type { FeedbackHeaderProps } from './feedback-header-animated'

// Defer framer-motion (~360KB minified) to a client-only chunk. The portal
// header is interactive — it expands on focus/click — so SSR only needs a
// static collapsed shell that matches the animated version's layout.
const FeedbackHeaderAnimated = lazy(() =>
  import('./feedback-header-animated').then((m) => ({ default: m.FeedbackHeaderAnimated }))
)

/** The longest title the composer takes; the loading composer holds to it too. */
export const TITLE_MAX_LENGTH = 200

interface FallbackProps {
  /**
   * Makes the shell typeable (the loading feed's composer): the title and a
   * click are kept and handed to the real composer once it loads.
   */
  title?: string
  onTitleChange?: (title: string) => void
  onFocus?: () => void
}

export function FeedbackHeaderFallback({ title, onTitleChange, onFocus }: FallbackProps = {}) {
  const intl = useIntl()
  const copy = useFeedCopy()
  return (
    <div
      data-qb-part="composer"
      className="bg-card border border-border rounded-lg mb-5 shadow-sm overflow-hidden"
    >
      <div className="flex items-center gap-3 px-4 py-3.5">
        <div className="flex-shrink-0 w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
          <PencilIcon className="w-4 h-4 text-primary" />
        </div>
        <input
          type="text"
          placeholder={
            copy.prompt ??
            intl.formatMessage({
              id: 'portal.feedback.header.titlePlaceholder',
              defaultMessage: "What's on your mind?",
            })
          }
          readOnly={!onTitleChange}
          maxLength={TITLE_MAX_LENGTH}
          value={onTitleChange ? title : undefined}
          onChange={onTitleChange && ((event) => onTitleChange(event.target.value))}
          onFocus={onFocus}
          aria-label={intl.formatMessage({
            id: 'portal.feedback.header.titleLabel',
            defaultMessage: 'Post title',
          })}
          className="min-w-0 flex-1 text-ellipsis bg-transparent border-0 outline-none text-foreground font-semibold placeholder:text-muted-foreground placeholder:font-normal"
        />
      </div>
    </div>
  )
}

export function FeedbackHeader(props: FeedbackHeaderProps) {
  return (
    <Suspense fallback={<FeedbackHeaderFallback />}>
      <FeedbackHeaderAnimated {...props} />
    </Suspense>
  )
}
