import { useIntl } from 'react-intl'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { adminQueries } from '@/lib/client/queries/admin'
import { setLaunchTaskResolutionFn } from '@/lib/server/functions/admin'
import { isLaunchPlanActive, type LaunchStatus } from '@/lib/shared/launch-checklist'

/** Poll only while the plan is open: a resolved plan has nothing left to watch for. */
export function launchStatusRefetchInterval(data: LaunchStatus | undefined): number | false {
  if (!data) return false
  return isLaunchPlanActive(data) ? 15_000 : false
}

/** The launch status for Home and the Launch plan page, kept fresh while the plan is open. */
export function launchStatusQuery() {
  return {
    ...adminQueries.onboardingStatus(),
    refetchInterval: (query: { state: { data?: LaunchStatus } }) =>
      launchStatusRefetchInterval(query.state.data),
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
