import { createFileRoute, redirect } from '@tanstack/react-router'
import { ScrollArea } from '@/components/ui/scroll-area'
import { LaunchPlanPage } from '@/components/onboarding/launch-plan-page'
import { FirstWinTestAction } from '@/components/onboarding/test-actions'
import { adminQueries } from '@/lib/client/queries/admin'
import { isAdmin } from '@/lib/shared/roles'

export const Route = createFileRoute('/admin/getting-started')({
  // The launch plan is the owner's; a teammate's first run is on Home.
  beforeLoad: ({ context }) => {
    if (!isAdmin(context.userRole)) throw redirect({ to: '/admin' })
  },
  loader: ({ context }) => context.queryClient.ensureQueryData(adminQueries.onboardingStatus()),
  component: () => (
    <ScrollArea className="h-full">
      <LaunchPlanPage firstWinAction={<FirstWinTestAction />} />
    </ScrollArea>
  ),
})
