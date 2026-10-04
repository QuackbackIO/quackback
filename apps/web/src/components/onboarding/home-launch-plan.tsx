import { useEffect, useState } from 'react'
import { FormattedMessage } from 'react-intl'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { useCopilotOnHome } from '@/components/admin/ask/copilot-on-home'
import { HomeNextStep } from './home-next-step'
import { HomeTourPrompt } from './home-tour-prompt'
import { useProductTour } from '@/components/onboarding/product-tour'
import {
  getOnboardingProgressFn,
  claimFirstWinMomentFn,
  dismissTourOfferFn,
} from '@/lib/server/functions/onboarding-progress'
import { CreateBoardDialog } from '@/components/admin/settings/boards/create-board-dialog'
import { AutomaticBrandingNotice } from '@/components/admin/branding/automatic-branding-notice'
import { useAutomaticWebsiteBranding } from '@/components/admin/branding/use-automatic-website-branding'
import { isLaunchPlanActive } from '@/lib/shared/launch-checklist'
import { launchStatusQuery, useLaunchTaskResolution } from './use-launch-plan'

const PROGRESS_KEY = ['onboarding', 'progress'] as const
type Progress = Awaited<ReturnType<typeof getOnboardingProgressFn>>

/** Home's first-run area: the celebration, the next step and its path, and the tour prompt. */
export function HomeGettingStarted({ portalUrl }: { portalUrl?: string }) {
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
  // On a phone the module stops are behind the menu drawer; with no Copilot
  // stop either, the tour would have nothing to show.
  const copilotOnHome = useCopilotOnHome()
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    setNarrow(window.matchMedia?.('(max-width: 639px)').matches ?? false)
  }, [])
  const showTourOffer =
    (!narrow || copilotOnHome) &&
    inWindow &&
    Boolean(progress.data) &&
    !progress.data?.tourSeenAt &&
    !progress.data?.tourDismissedAt
  const planShown = inWindow && isLaunchPlanActive(statusQuery.data)
  // The lookup starts only while its notice has a live launch plan to sit in.
  const branding = useAutomaticWebsiteBranding({ enabled: planShown })
  const brandingShown =
    branding.status?.status === 'applied' ||
    (branding.status?.status === 'offered' && branding.status.canUse)
  const brandingNotice = brandingShown && (
    <AutomaticBrandingNotice
      status={branding.status}
      pending={branding.pending}
      error={branding.error}
      onUndo={branding.undo}
      onAccept={branding.accept}
      onDismiss={branding.dismiss}
    />
  )

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
      {planShown ? (
        <HomeNextStep
          status={statusQuery.data}
          portalUrl={portalUrl}
          brandingNotice={brandingNotice}
          pending={resolutionMutation.isPending}
          onCreateBoard={() => setCreateBoardOpen(true)}
        />
      ) : null}
      {showTourOffer && (
        <HomeTourPrompt
          pending={dismissTour.isPending}
          onDismiss={() => dismissTour.mutate()}
          onStart={() => tour?.start()}
        />
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
