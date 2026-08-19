import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import {
  getChangelogSubscriptionStatusFn,
  setChangelogSubscriptionFn,
} from '@/lib/server/functions/changelog-subscriptions'
import type { PrincipalId } from '@quackback/ids'

function statusKey(principalId: PrincipalId) {
  return ['admin', 'changelog-subscription', principalId] as const
}

/**
 * Per-user changelog-emails toggle on the People directory profile
 * (Changelog Settings §2). Reused wherever an admin needs to see or change
 * whether a person receives changelog emails.
 */
export function ChangelogSubscriptionControl({ principalId }: { principalId: PrincipalId }) {
  const queryClient = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: statusKey(principalId),
    queryFn: () => getChangelogSubscriptionStatusFn({ data: { principalId } }),
    staleTime: 30_000,
  })

  const mutation = useMutation({
    mutationFn: (subscribed: boolean) =>
      setChangelogSubscriptionFn({ data: { principalId, subscribed } }),
    onSuccess: (saved) => {
      queryClient.setQueryData(statusKey(principalId), saved)
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : 'Failed to update'),
  })

  if (isLoading) return null

  const subscribed = data?.subscribed ?? false

  return (
    <div className="flex items-center justify-between py-1">
      <Label htmlFor="changelog-subscription-toggle" className="text-sm cursor-pointer">
        Changelog emails
      </Label>
      <Switch
        id="changelog-subscription-toggle"
        checked={subscribed}
        onCheckedChange={(checked) => mutation.mutate(checked)}
        disabled={mutation.isPending}
      />
    </div>
  )
}
