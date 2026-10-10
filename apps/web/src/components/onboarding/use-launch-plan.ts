import { useIntl } from 'react-intl'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { adminQueries } from '@/lib/client/queries/admin'
import { setLaunchTaskResolutionFn } from '@/lib/server/functions/admin'
import { getOnboardingProgressFn } from '@/lib/server/functions/onboarding-progress'
import { isLaunchPlanActive, type LaunchStatus } from '@/lib/shared/launch-checklist'

/** Poll only while the plan is open: a resolved plan has nothing left to watch for. */
export function launchStatusRefetchInterval(data: LaunchStatus | undefined): number | false {
  if (!data) return false
  return isLaunchPlanActive(data) ? 15_000 : false
}

/**
 * Catch up when the window regains focus only in the launch window, when a
 * step done in another tab or a first win can change what Home shows.
 */
export function refetchInLaunchWindow(query: { state: { data?: LaunchStatus } }): boolean {
  return query.state.data?.inLaunchWindow === true
}

/**
 * The launch status for Home and the Launch plan page, kept fresh while the
 * plan is open. A read that needs only the launch window (Home's greeting, a
 * teammate's first run) passes `poll: false`.
 */
export function launchStatusQuery({ poll = true }: { poll?: boolean } = {}) {
  return {
    ...adminQueries.onboardingStatus(),
    refetchOnWindowFocus: refetchInLaunchWindow,
    refetchInterval: poll
      ? (query: { state: { data?: LaunchStatus } }) => launchStatusRefetchInterval(query.state.data)
      : undefined,
  }
}

/** This person's own first-run markers: the tour taken or put off, the first win dismissed. */
export function onboardingProgressQuery() {
  return {
    queryKey: ['onboarding', 'progress'] as const,
    queryFn: () => getOnboardingProgressFn(),
  }
}

/** Skip a launch-plan task, or undo the skip with a null resolution. */
export function useLaunchTaskResolution() {
  const intl = useIntl()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (data: { taskId: string; resolution: 'dismissed' | null }) =>
      setLaunchTaskResolutionFn({ data }),
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
}
