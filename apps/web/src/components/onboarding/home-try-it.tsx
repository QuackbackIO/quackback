import { FormattedMessage } from 'react-intl'
import { useSuspenseQuery } from '@tanstack/react-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { isLaunchPlanActive, launchChecklistSummary } from '@/lib/shared/launch-checklist'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import { TryMessengerButton } from './try-messenger-button'

/** Home's "Try it yourself" card: both sides of a test idea or message, while the launch plan runs. */
export function HomeTryItYourself({ flags }: { flags: FeatureFlags | undefined }) {
  const { data } = useSuspenseQuery(adminQueries.onboardingStatus())
  const canTryMessage = !!flags?.supportInbox
  const canTryIdea = (flags?.feedback ?? true) && data.hasBoards
  if (!isLaunchPlanActive(launchChecklistSummary(data)) || !(canTryMessage || canTryIdea)) {
    return null
  }
  return (
    <section className="mt-5 flex flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-4">
      <h2 className="text-sm font-medium">
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
