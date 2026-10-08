import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { HomeFirstWin, HomePlanDone } from './home-first-win'
import { HomeNextStep } from './home-next-step'
import { HomeTourPrompt } from './home-tour-prompt'
import { useProductTour } from '@/components/onboarding/product-tour'
import {
  getOnboardingProgressFn,
  getFirstWinCardFn,
  dismissFirstWinFn,
  dismissTourOfferFn,
} from '@/lib/server/functions/onboarding-progress'
import { CreateBoardDialog } from '@/components/admin/settings/boards/create-board-dialog'
import { AutomaticBrandingNotice } from '@/components/admin/branding/automatic-branding-notice'
import { useAutomaticWebsiteBranding } from '@/components/admin/branding/use-automatic-website-branding'
import { isLaunchPlanActive, launchPath, openLaterSteps } from '@/lib/shared/launch-checklist'
import { adminQueries } from '@/lib/client/queries/admin'
import {
  launchStatusQuery,
  onboardingProgressQuery,
  useLaunchTaskResolution,
} from './use-launch-plan'

const PROGRESS_KEY = onboardingProgressQuery().queryKey
const FIRST_WIN_KEY = ['onboarding', 'first-win'] as const
type Progress = Awaited<ReturnType<typeof getOnboardingProgressFn>>

/** Home's first-run area: the launch plan card, then the celebration and the finished plan's row. */
export function HomeGettingStarted({
  portalUrl,
  member = false,
}: {
  portalUrl?: string
  /** A teammate's first run: the tour offer only, never the owner's plan or win. */
  member?: boolean
}) {
  const queryClient = useQueryClient()
  const [createBoardOpen, setCreateBoardOpen] = useState(false)
  const statusQuery = useSuspenseQuery(
    // A teammate only needs the launch window, so nothing polls for them.
    member ? adminQueries.onboardingStatus() : launchStatusQuery()
  )
  const resolutionMutation = useLaunchTaskResolution()

  // First-run behaviour belongs to the launch window: an established
  // workspace never sees it after an upgrade.
  const inWindow = statusQuery.data.inLaunchWindow === true
  // The named win stays on Home until this person dismisses it.
  const firstWin = useQuery({
    queryKey: FIRST_WIN_KEY,
    queryFn: () => getFirstWinCardFn(),
    enabled: !member && inWindow && statusQuery.data.hasFirstWin === true,
    staleTime: 60_000,
  })
  const dismissWin = useMutation({
    mutationFn: () => dismissFirstWinFn(),
    // The card and the sidebar dock both go as the person dismisses.
    onMutate: () => {
      queryClient.setQueryData(FIRST_WIN_KEY, null)
      queryClient.setQueryData<Progress>(PROGRESS_KEY, (current) => ({
        ...current,
        firstWinShownAt: new Date().toISOString(),
      }))
    },
  })
  const planShown = !member && inWindow && isLaunchPlanActive(statusQuery.data)
  // Once the plan is done, a quiet line keeps the optional steps in reach
  // until each is done or skipped. Only a workspace that had a launch plan.
  const path = launchPath(statusQuery.data)
  const optional =
    !member && statusQuery.data.launchWindow && path.complete ? openLaterSteps(path).length : 0
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
      {firstWin.data ? (
        <HomeFirstWin
          summary={firstWin.data.summary}
          pending={dismissWin.isPending}
          onDismiss={() => dismissWin.mutate()}
        />
      ) : null}
      {optional > 0 ? <HomePlanDone optional={optional} /> : null}
      {planShown ? (
        <HomeNextStep
          status={statusQuery.data}
          portalUrl={portalUrl}
          brandingNotice={brandingNotice}
          pending={resolutionMutation.isPending}
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

/**
 * The one-time tour offer, the last block on Home: in the launch window, until
 * this person takes the tour or says Not now, and for the owner only until the
 * first win ends the first run.
 */
export function HomeTourOffer({ member = false }: { member?: boolean }) {
  const tour = useProductTour()
  const queryClient = useQueryClient()
  const progress = useQuery(onboardingProgressQuery())
  const status = useQuery(member ? adminQueries.onboardingStatus() : launchStatusQuery())
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
  // On a phone the tour's stops are behind the menu drawer, so it is not offered.
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    setNarrow(window.matchMedia?.('(max-width: 639px)').matches ?? false)
  }, [])
  const shown =
    !narrow &&
    status.data?.inLaunchWindow === true &&
    (member || status.data.hasFirstWin !== true) &&
    Boolean(progress.data) &&
    !progress.data?.tourSeenAt &&
    !progress.data?.tourDismissedAt
  if (!shown) return null
  return (
    <HomeTourPrompt
      pending={dismissTour.isPending}
      onDismiss={() => dismissTour.mutate()}
      onStart={() => tour?.start()}
    />
  )
}
