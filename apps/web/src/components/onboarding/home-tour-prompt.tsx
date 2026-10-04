import { FormattedMessage } from 'react-intl'
import { Button } from '@/components/ui/button'

/**
 * The one-time tour offer, in the bottom-left corner of Home: quiet, out of
 * the way of the next step, and gone for good after Start or Not now.
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
      className="fixed bottom-4 left-4 z-30 flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-xl border bg-popover py-2 ps-4 pe-2 text-popover-foreground shadow-lg [--ring:var(--muted-foreground)] sm:left-[15rem]"
    >
      <h2 id="home-tour-prompt" className="text-sm font-medium sm:whitespace-nowrap">
        <FormattedMessage
          id="onboarding.tour.prompt"
          defaultMessage="New here? Take the 60-second tour"
        />
      </h2>
      <Button variant="ghost" size="sm" disabled={pending} onClick={onDismiss}>
        <FormattedMessage id="onboarding.tour.notNow" defaultMessage="Not now" />
      </Button>
      <Button size="sm" onClick={onStart}>
        <FormattedMessage id="onboarding.launch.start" defaultMessage="Start" />
      </Button>
    </section>
  )
}
