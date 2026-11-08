import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { FormattedMessage } from 'react-intl'
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
 * user: the changelog's leading action. Anonymous visitors have no email to
 * subscribe, so with `enabled` off it offers Subscribe as a way to sign in
 * (`onSignIn`), or nothing without one.
 */
export function ChangelogSubscribeButton({
  enabled,
  onSignIn,
}: {
  enabled: boolean
  onSignIn?: () => void
}) {
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

  if (!enabled)
    return onSignIn ? (
      <Button size="sm" className="shrink-0 gap-1.5" onClick={onSignIn}>
        <BellIcon className="h-4 w-4" />
        <FormattedMessage id="portal.changelog.subscribe" defaultMessage="Subscribe" />
      </Button>
    ) : null

  const subscribed = data?.subscribed ?? false
  const isPending = subscribeMutation.isPending || unsubscribeMutation.isPending

  return (
    <Button
      variant={subscribed ? 'outline' : 'default'}
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
      {subscribed ? (
        <FormattedMessage id="portal.changelog.subscribed" defaultMessage="Subscribed" />
      ) : (
        <FormattedMessage id="portal.changelog.subscribe" defaultMessage="Subscribe" />
      )}
    </Button>
  )
}
