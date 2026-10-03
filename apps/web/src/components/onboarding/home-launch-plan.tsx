import { useState, type ReactNode } from 'react'
import { FormattedMessage, useIntl } from 'react-intl'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useProductTour } from '@/components/onboarding/product-tour'
import {
  getOnboardingProgressFn,
  claimFirstWinMomentFn,
  dismissTourOfferFn,
} from '@/lib/server/functions/onboarding-progress'
import { GettingStartedCard } from '@/components/admin/getting-started-card'
import { CreateBoardDialog } from '@/components/admin/settings/boards/create-board-dialog'
import { adminQueries } from '@/lib/client/queries/admin'
import { setLaunchTaskResolutionFn } from '@/lib/server/functions/admin'
import {
  isLaunchPlanActive,
  launchChecklistSummary,
  normalizeOutcome,
} from '@/lib/shared/launch-checklist'

const PROGRESS_KEY = ['onboarding', 'progress'] as const
type Progress = Awaited<ReturnType<typeof getOnboardingProgressFn>>

export function HomeGettingStarted({
  full = false,
  portalUrl,
  tryIt,
}: {
  full?: boolean
  portalUrl?: string
  /** The "Try it yourself" card. Shown beside the tour offer, in the launch window only. */
  tryIt?: ReactNode
}) {
  const intl = useIntl()
  const tour = useProductTour()
  const progress = useQuery({
    queryKey: PROGRESS_KEY,
    queryFn: () => getOnboardingProgressFn(),
  })
  const [winDismissed, setWinDismissed] = useState(false)
  const queryClient = useQueryClient()
  const [createBoardOpen, setCreateBoardOpen] = useState(false)
  const statusQuery = useSuspenseQuery({
    ...adminQueries.onboardingStatus(),
    refetchInterval: (query) => {
      const data = query.state.data
      if (!data) return false
      return !data.hasFirstWin ? 15_000 : false
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
        error instanceof Error
          ? error.message
          : intl.formatMessage({
              id: 'onboarding.launch.error',
              defaultMessage: 'Could not update your launch plan. Try again.',
            })
      ),
  })

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
      !full &&
      inWindow &&
      statusQuery.data.hasFirstWin === true &&
      Boolean(progress.data) &&
      !progress.data?.firstWinShownAt,
    staleTime: Infinity,
    gcTime: 0,
  })
  const showWin = !full && moment.data?.show && !winDismissed
  const showTourOffer =
    !full &&
    inWindow &&
    Boolean(progress.data) &&
    !progress.data?.tourSeenAt &&
    !progress.data?.tourDismissedAt
  const showTryIt = !full && inWindow && Boolean(tryIt)

  return (
    <>
      {showWin && (
        <section className="rounded-xl border bg-card p-4 flex items-center justify-between gap-4">
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
      {full || (inWindow && isLaunchPlanActive(launchChecklistSummary(statusQuery.data))) ? (
        <GettingStartedCard
          full={full}
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
            <section className="[--ring:var(--muted-foreground)] flex items-center gap-2 rounded-xl border bg-card py-2.5 ps-4 pe-2.5">
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
