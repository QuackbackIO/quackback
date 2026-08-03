/**
 * Per-ticket subscription dropdown rendered in the ticket detail header.
 * Lets the current principal subscribe / unsubscribe / toggle the 6 event
 * preferences / mute (1h, 1d, 1w, until unmute).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BellIcon, BellSlashIcon, BellAlertIcon } from '@heroicons/react/24/outline'
import { BellIcon as BellIconSolid } from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import type { TicketId } from '@quackback/ids'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  getMyTicketSubscriptionFn,
  subscribeToTicketFn,
  unsubscribeFromTicketFn,
  updateTicketSubscriptionPrefsFn,
  muteTicketFn,
  unmuteTicketFn,
} from '@/lib/server/functions/notifications'

const PREF_FLAGS = [
  { key: 'notifyThreads', label: 'New replies' },
  { key: 'notifyStatus', label: 'Status changes' },
  { key: 'notifyAssignment', label: 'Assignment changes' },
  { key: 'notifyParticipants', label: 'Participant changes' },
  { key: 'notifyShares', label: 'Share grants' },
  { key: 'notifySla', label: 'SLA warnings & breaches' },
] as const

type PrefKey = (typeof PREF_FLAGS)[number]['key']

const MUTE_DURATIONS: Array<{ label: string; ms: number | null }> = [
  { label: 'Mute for 1 hour', ms: 60 * 60 * 1000 },
  { label: 'Mute for 1 day', ms: 24 * 60 * 60 * 1000 },
  { label: 'Mute for 1 week', ms: 7 * 24 * 60 * 60 * 1000 },
  { label: 'Mute until I unmute', ms: null },
]

export interface TicketSubscriptionMenuProps {
  ticketId: TicketId
}

export function TicketSubscriptionMenu({ ticketId }: TicketSubscriptionMenuProps) {
  const qc = useQueryClient()
  const queryKey = ['tickets', 'my-subscription', ticketId] as const

  const { data: sub, isLoading } = useQuery({
    queryKey,
    queryFn: () => getMyTicketSubscriptionFn({ data: { ticketId } }),
  })

  const invalidate = () => qc.invalidateQueries({ queryKey })

  const subscribeMutation = useMutation({
    mutationFn: () => subscribeToTicketFn({ data: { ticketId } }),
    onSuccess: () => {
      invalidate()
      toast.success('Subscribed')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const unsubscribeMutation = useMutation({
    mutationFn: () => unsubscribeFromTicketFn({ data: { ticketId } }),
    onSuccess: () => {
      invalidate()
      toast.success('Unsubscribed')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const updatePrefsMutation = useMutation({
    mutationFn: (patch: Partial<Record<PrefKey, boolean>>) =>
      updateTicketSubscriptionPrefsFn({ data: { ticketId, patch } }),
    onSuccess: () => invalidate(),
    onError: (e: Error) => toast.error(e.message),
  })

  const muteMutation = useMutation({
    mutationFn: (untilIso?: string) =>
      muteTicketFn({ data: untilIso ? { ticketId, untilIso } : { ticketId } }),
    onSuccess: () => {
      invalidate()
      toast.success('Muted')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const unmuteMutation = useMutation({
    mutationFn: () => unmuteTicketFn({ data: { ticketId } }),
    onSuccess: () => {
      invalidate()
      toast.success('Unmuted')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const isSubscribed = !!sub
  const mutedUntil = sub?.mutedUntil ? new Date(sub.mutedUntil) : null
  const isMuted = !!mutedUntil && mutedUntil.getTime() > Date.now()

  let Icon = BellIcon
  let iconClass = 'text-muted-foreground'
  let ariaLabel = 'Subscribe to ticket'
  if (isMuted) {
    Icon = BellSlashIcon
    iconClass = 'text-amber-500'
    ariaLabel = 'Subscription menu (muted)'
  } else if (isSubscribed) {
    Icon = BellIconSolid
    iconClass = 'text-primary'
    ariaLabel = 'Subscription menu (subscribed)'
  }

  const busy =
    isLoading ||
    subscribeMutation.isPending ||
    unsubscribeMutation.isPending ||
    updatePrefsMutation.isPending ||
    muteMutation.isPending ||
    unmuteMutation.isPending

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="ghost" aria-label={ariaLabel} disabled={busy}>
          <Icon className={`h-4 w-4 ${iconClass}`} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>Notifications</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {!isSubscribed ? (
          <DropdownMenuItem onSelect={() => subscribeMutation.mutate()}>
            <BellIcon className="h-4 w-4 mr-2" />
            Subscribe
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem onSelect={() => unsubscribeMutation.mutate()}>
              <BellSlashIcon className="h-4 w-4 mr-2" />
              Unsubscribe
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <BellAlertIcon className="h-4 w-4 mr-2" />
                Customize prefs
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="w-56">
                {PREF_FLAGS.map((f) => (
                  <DropdownMenuCheckboxItem
                    key={f.key}
                    checked={!!sub?.[f.key]}
                    onCheckedChange={(checked) =>
                      updatePrefsMutation.mutate({ [f.key]: !!checked })
                    }
                    onSelect={(e) => e.preventDefault()}
                  >
                    {f.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <BellSlashIcon className="h-4 w-4 mr-2" />
                Mute
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {MUTE_DURATIONS.map((d) => (
                  <DropdownMenuItem
                    key={d.label}
                    onSelect={() =>
                      muteMutation.mutate(
                        d.ms === null ? undefined : new Date(Date.now() + d.ms).toISOString()
                      )
                    }
                  >
                    {d.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            {isMuted && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => unmuteMutation.mutate()}>
                  <BellIcon className="h-4 w-4 mr-2" />
                  Unmute
                </DropdownMenuItem>
              </>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
