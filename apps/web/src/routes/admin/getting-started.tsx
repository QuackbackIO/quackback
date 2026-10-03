import { createFileRoute } from '@tanstack/react-router'
import { ScrollArea } from '@/components/ui/scroll-area'
import { LaunchPlanPage } from '@/components/onboarding/launch-plan-page'
import { adminQueries } from '@/lib/client/queries/admin'

export const Route = createFileRoute('/admin/getting-started')({
  loader: ({ context }) => context.queryClient.ensureQueryData(adminQueries.onboardingStatus()),
  component: () => (
    <ScrollArea className="h-full">
      <LaunchPlanPage />
    </ScrollArea>
  ),
})
