import { useEffect, useRef, useState, type RefObject } from 'react'
import { useIntl } from 'react-intl'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import {
  HOME_PLAN_DONE_HEADING_ID,
  HOME_WIN_HEADING_ID,
  HomeFirstWin,
  HomePlanDone,
  planDoneText,
  winTitleMessage,
} from './home-first-win'
import { HOME_PLAN_HEADING_ID, HomeNextStep, stepAnnouncement } from './home-next-step'
import { HOME_GREETING_ID } from './home-greeting'
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
import {
  isLaunchPlanActive,
  launchPath,
  openLaterSteps,
  type LaunchTask,
} from '@/lib/shared/launch-checklist'
import { adminQueries } from '@/lib/client/queries/admin'
import {
  launchStatusQuery,
  onboardingProgressQuery,
  useLaunchTaskResolution,
} from './use-launch-plan'

const PROGRESS_KEY = onboardingProgressQuery().queryKey
const FIRST_WIN_KEY = ['onboarding', 'first-win'] as const
type Progress = Awaited<ReturnType<typeof getOnboardingProgressFn>>

/** What Home's first-run area shows: the plan at a step, the win, the finished plan's row, or nothing. */
type AreaView = { key: string; focus: string; announce: string }

/**
 * When the area changes in place (a step completes, the first win arrives,
 * Dismiss), move focus to the new card's heading if focus was in the old
 * card, and say what changed through one polite live region.
 */
function useInPlaceChange(area: RefObject<HTMLDivElement | null>, view: AreaView | null) {
  const focusInside = useRef(false)
  const shown = useRef(view?.key)
  const [announcement, setAnnouncement] = useState('')
  useEffect(() => {
    const track = (event: FocusEvent) => {
      focusInside.current = area.current?.contains(event.target as Node) ?? false
    }
    document.addEventListener('focusin', track)
    return () => document.removeEventListener('focusin', track)
  }, [area])
  useEffect(() => {
    // Wait while the next view is still loading, so it changes once.
    if (!view || shown.current === view.key) return
    const first = shown.current === undefined
    shown.current = view.key
    if (first) return
    setAnnouncement(view.announce)
    const active = document.activeElement
    const lost = !active || active === document.body || area.current?.contains(active)
    if (focusInside.current && lost) document.getElementById(view.focus)?.focus()
  }, [area, view])
  return announcement
}

/** Home's first-run area: the launch plan card, then the celebration and the finished plan's row. */
export function HomeGettingStarted({
  portalUrl,
  member = false,
}: {
  portalUrl?: string
  /** A teammate's first run: the tour offer only, never the owner's plan or win. */
  member?: boolean
}) {
  const intl = useIntl()
  const queryClient = useQueryClient()
  const area = useRef<HTMLDivElement>(null)
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
  const winExpected = !member && inWindow && statusQuery.data.hasFirstWin === true
  const firstWin = useQuery({
    queryKey: FIRST_WIN_KEY,
    queryFn: () => getFirstWinCardFn(),
    enabled: winExpected,
    staleTime: 60_000,
  })
  const winLoading = winExpected && firstWin.isPending
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
    !member && statusQuery.data.launchWindow && path.complete && !winLoading
      ? openLaterSteps(path).length
      : 0
  // The step the plan led with last time, to say it is done when the plan moves on.
  const lastStep = useRef<LaunchTask | null>(path.next)
  const view: AreaView | null =
    planShown && path.next
      ? {
          key: `plan:${path.next.id}`,
          focus: HOME_PLAN_HEADING_ID,
          announce: stepAnnouncement(intl, lastStep.current, path.next, path.steps),
        }
      : firstWin.data
        ? {
            key: 'win',
            focus: HOME_WIN_HEADING_ID,
            announce: intl.formatMessage(winTitleMessage(firstWin.data.summary)),
          }
        : winLoading
          ? null
          : optional > 0
            ? {
                key: 'done',
                focus: HOME_PLAN_DONE_HEADING_ID,
                announce: planDoneText(intl, optional),
              }
            : { key: 'none', focus: HOME_GREETING_ID, announce: '' }
  useEffect(() => {
    if (planShown) lastStep.current = path.next
  })
  const announcement = useInPlaceChange(area, view)
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
      <div ref={area} className="space-y-6 empty:hidden">
        {planShown ? (
          <HomeNextStep
            status={statusQuery.data}
            portalUrl={portalUrl}
            brandingNotice={brandingNotice}
            pending={resolutionMutation.isPending}
            onCreateBoard={() => setCreateBoardOpen(true)}
          />
        ) : null}
        {firstWin.data ? (
          <HomeFirstWin
            summary={firstWin.data.summary}
            pending={dismissWin.isPending}
            onDismiss={() => dismissWin.mutate()}
          />
        ) : null}
        {optional > 0 ? <HomePlanDone optional={optional} /> : null}
      </div>
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
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
