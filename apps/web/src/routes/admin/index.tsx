import { Suspense, useState } from 'react'
import { createFileRoute, useRouteContext } from '@tanstack/react-router'
import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { ScrollArea } from '@/components/ui/scroll-area'
import { GettingStartedCard } from '@/components/admin/getting-started-card'
import { OverviewDashboard } from '@/components/admin/admin-overview'
import { HomeActions } from '@/components/admin/home-actions'
import { CreateBoardDialog } from '@/components/admin/settings/boards/create-board-dialog'
import { adminQueries } from '@/lib/client/queries/admin'
import { adminOverviewQueries } from '@/lib/client/queries/admin-overview'
import { setLaunchTaskResolutionFn } from '@/lib/server/functions/admin'
import { ensureOnboardingHomeReadyFn } from '@/lib/server/functions/onboarding'
import {
  isLaunchPlanActive,
  launchChecklistSummary,
  normalizeOutcome,
} from '@/lib/shared/launch-checklist'
import { isAdmin } from '@/lib/shared/roles'
import type { FeatureFlags } from '@/lib/shared/types/settings'

export const Route = createFileRoute('/admin/')({
  loader: async ({ context }) => {
    const admin = isAdmin(context.userRole)
    await context.queryClient.ensureQueryData(adminOverviewQueries.get())
    if (admin) {
      await ensureOnboardingHomeReadyFn()
      await context.queryClient.ensureQueryData(adminQueries.onboardingStatus())
    }
  },
  component: AdminOverviewPage,
})

function AdminOverviewPage() {
  const { userRole, settings } = useRouteContext({ from: '__root__' })
  const admin = isAdmin(userRole)
  const flags = settings?.featureFlags as FeatureFlags | undefined

  return (
    <ScrollArea className="h-full">
      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 pt-4 pb-16 sm:px-6">
        <OverviewDashboard
          actions={<HomeActions flags={flags} />}
          banner={
            admin ? (
              <Suspense fallback={null}>
                <HomeGettingStarted />
              </Suspense>
            ) : null
          }
        />
      </div>
    </ScrollArea>
  )
}

function HomeGettingStarted() {
  const queryClient = useQueryClient()
  const [createBoardOpen, setCreateBoardOpen] = useState(false)
  const statusQuery = useSuspenseQuery({
    ...adminQueries.onboardingStatus(),
    refetchInterval: (query) => {
      const data = query.state.data
      if (!data) return false
      return isLaunchPlanActive(launchChecklistSummary(data)) ? 15_000 : false
    },
  })
  const resolutionMutation = useMutation({
    mutationFn: (data: { taskId: string; resolution: 'dismissed' | null }) =>
      setLaunchTaskResolutionFn({
        data: {
          ...data,
          outcome: normalizeOutcome(statusQuery.data.useCase),
        },
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin', 'onboarding'] }),
    onError: (error) =>
      toast.error(
        error instanceof Error ? error.message : 'We couldn’t update your launch plan. Try again.'
      ),
  })

  return (
    <>
      {isLaunchPlanActive(launchChecklistSummary(statusQuery.data)) ? (
        <GettingStartedCard
          status={statusQuery.data}
          pending={resolutionMutation.isPending}
          onSkip={(taskId) => resolutionMutation.mutate({ taskId, resolution: 'dismissed' })}
          onCreateBoard={() => setCreateBoardOpen(true)}
        />
      ) : null}
      <CreateBoardDialog
        open={createBoardOpen}
        onOpenChange={setCreateBoardOpen}
        redirectOnCreate={false}
        onCreated={() => {
          void queryClient.invalidateQueries({ queryKey: ['admin', 'onboarding'] })
        }}
      />
    </>
  )
}
