import { FormattedMessage } from 'react-intl'
import { Button } from '@/components/ui/button'

/**
 * The one-time tour offer: a quiet card at the end of Home's column, in the
 * page like every other card so it never covers the plan, and gone for good
 * after Take tour or Not now. Its button is an outline one: the plan's step
 * keeps the one filled button.
 */
export function HomeTourPrompt({
  onStart,
  onDismiss,
  pending,
}: {
  onStart: () => void
  onDismiss: () => void
  pending: boolean
}) {
  return (
    <section
      aria-labelledby="home-tour-prompt"
      className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-panel border border-border bg-card px-5 py-4 [--ring:var(--muted-foreground)]"
    >
      <h2 id="home-tour-prompt" className="text-sm font-medium">
        <FormattedMessage
          id="onboarding.tour.prompt"
          defaultMessage="New here? Take the 60-second tour"
        />
      </h2>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" disabled={pending} onClick={onDismiss}>
          <FormattedMessage id="onboarding.tour.notNow" defaultMessage="Not now" />
        </Button>
        <Button variant="outline" size="sm" onClick={onStart}>
          <FormattedMessage id="onboarding.tour.take" defaultMessage="Take tour" />
        </Button>
      </div>
    </section>
  )
}
