import { createFileRoute } from '@tanstack/react-router'
import { FormattedMessage } from 'react-intl'
import { HomeGettingStarted } from '@/components/onboarding/home-launch-plan'
import { adminQueries } from '@/lib/client/queries/admin'

export const Route = createFileRoute('/admin/getting-started')({
  loader: ({ context }) => context.queryClient.ensureQueryData(adminQueries.onboardingStatus()),
  component: () => (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">
        <FormattedMessage id="onboarding.launch.title" defaultMessage="Your launch plan" />
      </h1>
      <HomeGettingStarted full />
    </div>
  ),
})
