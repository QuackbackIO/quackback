import { FormattedMessage } from 'react-intl'
import { UserIcon } from '@heroicons/react/24/outline'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import { HomeGettingStarted } from './home-launch-plan'
import { useTestPaths, type TestPaths } from './test-actions'
import { TryMessengerButton } from './try-messenger-button'

/**
 * Home's first-run area with the "Try it yourself" card in its try-it slot.
 * The slot shows only in the launch window, and the card only when one of its
 * test paths will work.
 */
export function HomeLaunchArea({
  portalUrl,
  flags,
}: {
  portalUrl?: string
  flags: FeatureFlags | undefined
}) {
  const paths = useTestPaths(flags)
  return (
    <HomeGettingStarted
      portalUrl={portalUrl}
      tryIt={paths.message || paths.idea ? <TryItCard paths={paths} /> : undefined}
    />
  )
}

/** Home's "Try it yourself" card: both sides of a test idea or message. */
export function HomeTryItYourself({ flags }: { flags: FeatureFlags | undefined }) {
  const paths = useTestPaths(flags)
  if (!paths.message && !paths.idea) return null
  return <TryItCard paths={paths} />
}

function TryItCard({ paths }: { paths: TestPaths }) {
  const canTryIdea = paths.idea
  const canTryMessage = paths.message
  return (
    <section className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-4 shadow-raise">
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted"
        aria-hidden="true"
      >
        <UserIcon className="size-5 text-muted-foreground" />
      </span>
      <h2 className="min-w-0 flex-1 text-sm font-medium">
        <FormattedMessage id="onboarding.test.tryTitle" defaultMessage="Try it yourself" />
      </h2>
      <div className="flex flex-wrap gap-2">
        {canTryIdea && (
          <TryMessengerButton start="idea" variant="outline" size="sm">
            <FormattedMessage id="onboarding.test.postIdea" defaultMessage="Post an idea" />
          </TryMessengerButton>
        )}
        {canTryMessage && (
          <TryMessengerButton start="message" variant="outline" size="sm">
            <FormattedMessage id="onboarding.test.sendMessage" defaultMessage="Send a message" />
          </TryMessengerButton>
        )}
      </div>
    </section>
  )
}
