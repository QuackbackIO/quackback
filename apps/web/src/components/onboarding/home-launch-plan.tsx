import { useState, type ReactNode } from 'react'
import { PlayIcon } from '@heroicons/react/24/solid'
import { FormattedMessage, useIntl } from 'react-intl'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useProductTour } from '@/components/onboarding/product-tour'
import {
  getOnboardingProgressFn,
  claimFirstWinMomentFn,
} from '@/lib/server/functions/onboarding-progress'
import { GettingStartedCard } from '@/components/admin/getting-started-card'
import { CreateBoardDialog } from '@/components/admin/settings/boards/create-board-dialog'
import { AutomaticBrandingNotice } from '@/components/admin/branding/automatic-branding-notice'
import { useAutomaticWebsiteBranding } from '@/components/admin/branding/use-automatic-website-branding'
import { adminQueries } from '@/lib/client/queries/admin'
import { setLaunchTaskResolutionFn } from '@/lib/server/functions/admin'
import {
  isLaunchPlanActive,
  launchChecklistSummary,
  normalizeOutcome,
} from '@/lib/shared/launch-checklist'

export function HomeGettingStarted({
  full = false,
  portalUrl,
  compact = false,
  children,
}: {
  full?: boolean
  portalUrl?: string
  compact?: boolean
  children?: ReactNode
}) {
  const intl = useIntl()
  const tour = useProductTour()
  const branding = useAutomaticWebsiteBranding({ enabled: !full })
  const brandingNotice =
    !full && branding.status?.status === 'applied' ? (
      <AutomaticBrandingNotice
        status={branding.status}
        pending={branding.pending}
        error={branding.error}
        onUndo={branding.undo}
      />
    ) : undefined
  const progress = useQuery({
    queryKey: ['onboarding', 'progress'],
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

  const moment = useQuery({
    queryKey: ['onboarding', 'first-win-moment'],
    queryFn: () => claimFirstWinMomentFn(),
    enabled:
      !full &&
      statusQuery.data.hasFirstWin &&
      Boolean(progress.data) &&
      !progress.data?.firstWinShownAt,
    staleTime: Infinity,
    gcTime: 0,
  })
  const showWin = !full && moment.data?.show && !winDismissed

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
      {full || brandingNotice || isLaunchPlanActive(launchChecklistSummary(statusQuery.data)) ? (
        <GettingStartedCard
          full={full}
          portalUrl={portalUrl}
          compact={compact}
          status={statusQuery.data}
          brandingNotice={brandingNotice}
          pending={resolutionMutation.isPending}
          onSkip={(taskId) => resolutionMutation.mutate({ taskId, resolution: 'dismissed' })}
          onCreateBoard={() => setCreateBoardOpen(true)}
        />
      ) : null}
      {!full && (
        <div
          className={
            !compact && progress.data && !progress.data.tourSeenAt && children
              ? 'mt-4 grid gap-3 md:grid-cols-2'
              : 'mt-4 grid gap-3'
          }
        >
          {progress.data && !progress.data.tourSeenAt && (
            <section className="[--ring:var(--muted-foreground)] flex items-center gap-3 rounded-xl border bg-card p-4">
              <span
                className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-foreground text-background"
                aria-hidden="true"
              >
                <PlayIcon className="size-4 text-primary" />
              </span>
              <h2 className="min-w-0 flex-1 text-sm font-medium">
                <FormattedMessage
                  id="onboarding.tour.offer"
                  defaultMessage="Take the 60-second tour"
                />
              </h2>
              <Button variant="outline" size="sm" onClick={() => tour?.start()}>
                <FormattedMessage id="onboarding.launch.start" defaultMessage="Start" />
              </Button>
            </section>
          )}
          {children}
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
