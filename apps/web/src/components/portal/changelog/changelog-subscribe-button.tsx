import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { BellIcon } from '@heroicons/react/24/outline'
import { BellIcon as BellIconSolid } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import {
  subscribeToChangelogFn,
  unsubscribeFromChangelogFn,
  getMyChangelogSubscriptionFn,
} from '@/lib/server/functions/changelog-subscriptions'

const QUERY_KEY = ['changelog', 'my-subscription'] as const

/**
 * Self-serve Subscribe/Subscribed toggle for a signed-in, identified portal
 * user. Rendered only when the caller is authenticated (anonymous visitors
 * have no email to subscribe) — see the `enabled` check the caller passes.
 */
export function ChangelogSubscribeButton({ enabled }: { enabled: boolean }) {
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => getMyChangelogSubscriptionFn(),
    enabled,
    staleTime: 30_000,
  })

  const subscribeMutation = useMutation({
    mutationFn: () => subscribeToChangelogFn(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  })
  const unsubscribeMutation = useMutation({
    mutationFn: () => unsubscribeFromChangelogFn(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
  })

  if (!enabled) return null

  const subscribed = data?.subscribed ?? false
  const isPending = subscribeMutation.isPending || unsubscribeMutation.isPending

  return (
    <Button
      variant="outline"
      size="sm"
      className="shrink-0 gap-1.5"
      disabled={isPending}
      onClick={() => (subscribed ? unsubscribeMutation.mutate() : subscribeMutation.mutate())}
    >
      {subscribed ? (
        <BellIconSolid className="h-4 w-4 text-primary" />
      ) : (
        <BellIcon className="h-4 w-4" />
      )}
      <span className="hidden sm:inline">{subscribed ? 'Subscribed' : 'Subscribe'}</span>
    </Button>
  )
}
