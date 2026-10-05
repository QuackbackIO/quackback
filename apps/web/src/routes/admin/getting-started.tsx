import { createFileRoute, redirect } from '@tanstack/react-router'
import { ScrollArea } from '@/components/ui/scroll-area'
import { LaunchPlanPage } from '@/components/onboarding/launch-plan-page'
import { FirstWinTestAction } from '@/components/onboarding/test-actions'
import { LaunchMessages } from '@/components/onboarding/launch-messages'
import { adminQueries } from '@/lib/client/queries/admin'
import { DEFAULT_LOCALE, loadLaunchMessages } from '@/lib/shared/i18n'
import { isAdmin } from '@/lib/shared/roles'

export const Route = createFileRoute('/admin/getting-started')({
  // The launch plan is the owner's; a teammate's first run is on Home.
  beforeLoad: ({ context }) => {
    if (!isAdmin(context.userRole)) throw redirect({ to: '/admin' })
  },
  loader: async ({ context }) => {
    // The page's own strings, which the admin seed leaves out.
    const [launchMessages] = await Promise.all([
      loadLaunchMessages(context.acceptLanguageLocale ?? DEFAULT_LOCALE),
      context.queryClient.ensureQueryData(adminQueries.onboardingStatus()),
    ])
    return { launchMessages }
  },
  component: GettingStartedPage,
})

function GettingStartedPage() {
  const { launchMessages } = Route.useLoaderData()
  return (
    <LaunchMessages messages={launchMessages}>
      <ScrollArea className="h-full">
        <LaunchPlanPage firstWinAction={<FirstWinTestAction />} />
      </ScrollArea>
    </LaunchMessages>
  )
}
