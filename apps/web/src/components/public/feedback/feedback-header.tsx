import { lazy, Suspense } from 'react'
import { useIntl } from 'react-intl'
import { PencilIcon } from '@heroicons/react/24/solid'
import type { FeedbackHeaderProps } from './feedback-header-animated'

// Defer framer-motion (~360KB minified) to a client-only chunk. The portal
// header is interactive — it expands on focus/click — so SSR only needs a
// static collapsed shell that matches the animated version's layout.
const FeedbackHeaderAnimated = lazy(() =>
  import('./feedback-header-animated').then((m) => ({ default: m.FeedbackHeaderAnimated }))
)

function FeedbackHeaderFallback() {
  const intl = useIntl()
  return (
    <div className="bg-card border border-border rounded-lg mb-5 shadow-sm overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3.5">
        <div className="flex-shrink-0 w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
          <PencilIcon className="w-4 h-4 text-primary" />
        </div>
        <input
          type="text"
          placeholder={intl.formatMessage({
            id: 'portal.feedback.header.titlePlaceholder',
            defaultMessage: "What's your idea?",
          })}
          readOnly
          className="flex-1 bg-transparent border-0 outline-none text-foreground font-semibold placeholder:text-muted-foreground/60 placeholder:font-normal"
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
