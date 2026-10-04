import { useState, type ReactNode } from 'react'
import { FormattedMessage } from 'react-intl'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { useProductTour } from '@/components/onboarding/product-tour'
import {
  getOnboardingProgressFn,
  claimFirstWinMomentFn,
  dismissTourOfferFn,
} from '@/lib/server/functions/onboarding-progress'
import { GettingStartedCard } from '@/components/admin/getting-started-card'
import { CreateBoardDialog } from '@/components/admin/settings/boards/create-board-dialog'
import { isLaunchPlanActive, launchChecklistSummary } from '@/lib/shared/launch-checklist'
import { launchStatusQuery, useLaunchTaskResolution } from './use-launch-plan'

const PROGRESS_KEY = ['onboarding', 'progress'] as const
type Progress = Awaited<ReturnType<typeof getOnboardingProgressFn>>

/** Home's first-run area: the celebration, the launch tiles, the tour offer and the try-it slot. */
export function HomeGettingStarted({
  portalUrl,
  tryIt,
}: {
  portalUrl?: string
  /** The "Try it yourself" card. Shown beside the tour offer, in the launch window only. */
  tryIt?: ReactNode
}) {
  const tour = useProductTour()
  const progress = useQuery({
    queryKey: PROGRESS_KEY,
    queryFn: () => getOnboardingProgressFn(),
  })
  const [winDismissed, setWinDismissed] = useState(false)
  const queryClient = useQueryClient()
  const [createBoardOpen, setCreateBoardOpen] = useState(false)
  const statusQuery = useSuspenseQuery(launchStatusQuery())
  const resolutionMutation = useLaunchTaskResolution()

  const dismissTour = useMutation({
    mutationFn: () => dismissTourOfferFn(),
    onMutate: () => {
      queryClient.setQueryData<Progress>(PROGRESS_KEY, (current) => ({
        ...current,
        tourDismissedAt: new Date().toISOString(),
      }))
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: PROGRESS_KEY }),
  })

  // First-run behaviour belongs to the launch window: an established
  // workspace never sees it after an upgrade.
  const inWindow = statusQuery.data.inLaunchWindow === true
  const moment = useQuery({
    queryKey: ['onboarding', 'first-win-moment'],
    queryFn: () => claimFirstWinMomentFn(),
    enabled:
      inWindow &&
      statusQuery.data.hasFirstWin === true &&
      Boolean(progress.data) &&
      !progress.data?.firstWinShownAt,
    staleTime: Infinity,
    gcTime: 0,
  })
  const showWin = moment.data?.show && !winDismissed
  const showTourOffer =
    inWindow &&
    Boolean(progress.data) &&
    !progress.data?.tourSeenAt &&
    !progress.data?.tourDismissedAt
  const showTryIt = inWindow && Boolean(tryIt)

  return (
    <>
      {showWin && (
        <section className="rounded-xl border bg-card p-4 shadow-raise flex items-center justify-between gap-4">
          <p className="text-sm font-medium">
            <FormattedMessage
              id="onboarding.home.firstWin"
              defaultMessage="Your first real result is here."
            />
          </p>
          <Button variant="ghost" size="sm" onClick={() => setWinDismissed(true)}>
            <FormattedMessage id="onboarding.home.dismiss" defaultMessage="Dismiss" />
          </Button>
        </section>
      )}
      {inWindow && isLaunchPlanActive(launchChecklistSummary(statusQuery.data)) ? (
        <GettingStartedCard
          portalUrl={portalUrl}
          status={statusQuery.data}
          pending={resolutionMutation.isPending}
          onSkip={(taskId) => resolutionMutation.mutate({ taskId, resolution: 'dismissed' })}
          onCreateBoard={() => setCreateBoardOpen(true)}
        />
      ) : null}
      {(showTourOffer || showTryIt) && (
        <div
          className={
            showTourOffer && showTryIt ? 'mt-4 grid gap-3 md:grid-cols-2' : 'mt-4 grid gap-3'
          }
        >
          {showTourOffer && (
            <section className="[--ring:var(--muted-foreground)] flex items-center gap-2 rounded-xl border bg-card py-2.5 shadow-raise ps-4 pe-2.5">
              <h2 className="min-w-0 flex-1 text-sm font-medium">
                <FormattedMessage
                  id="onboarding.tour.offer"
                  defaultMessage="Take the 60-second tour"
                />
              </h2>
              <Button
                variant="ghost"
                size="sm"
                disabled={dismissTour.isPending}
                onClick={() => dismissTour.mutate()}
              >
                <FormattedMessage id="onboarding.tour.notNow" defaultMessage="Not now" />
              </Button>
              <Button size="sm" onClick={() => tour?.start()}>
                <FormattedMessage id="onboarding.launch.start" defaultMessage="Start" />
              </Button>
            </section>
          )}
          {showTryIt ? tryIt : null}
        </div>
      )}
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
