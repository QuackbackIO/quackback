/**
 * Detail-page header for a single ticket. Shows subject, breadcrumb back to
 * queue, channel/priority/visibility metadata, and Take/Return + delete
 * actions. Status transitions live in the properties panel.
 */
import { Link, useRouter } from '@tanstack/react-router'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftIcon, TrashIcon } from '@heroicons/react/24/outline'
import type { TicketId, PrincipalId } from '@quackback/ids'
import { Button } from '@/components/ui/button'
import { TimeAgo } from '@/components/ui/time-ago'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { TicketChannelIcon, type TicketChannel } from './ticket-channel-icon'
import { TicketPriorityChip, type TicketPriority } from './ticket-priority-chip'
import { TicketSubscriptionMenu } from './ticket-subscription-menu'
import { takeTicketFn, returnTicketFn, softDeleteTicketFn } from '@/lib/server/functions/tickets'
import { ticketQueries } from '@/lib/client/queries/tickets'
import { toast } from 'sonner'

const VISIBILITY_LABELS: Record<string, string> = {
  team: 'Team',
  org: 'Organization',
  shared: 'Shared',
  private: 'Private',
}

export interface TicketDetailHeaderProps {
  ticket: {
    id: TicketId
    subject: string
    channel: string
    priority: string
    visibilityScope: string
    updatedAt: Date | string
    assigneePrincipalId: PrincipalId | null
  }
  currentPrincipalId: PrincipalId
}

export function TicketDetailHeader({ ticket, currentPrincipalId }: TicketDetailHeaderProps) {
  const router = useRouter()
  const qc = useQueryClient()

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ticketQueries.detail(ticket.id).queryKey })
    qc.invalidateQueries({ queryKey: ['tickets', 'list'] })
  }

  const takeMutation = useMutation({
    mutationFn: () => takeTicketFn({ data: { ticketId: ticket.id } }),
    onSuccess: () => {
      invalidate()
      toast.success('Assigned to you')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const returnMutation = useMutation({
    mutationFn: () => returnTicketFn({ data: { ticketId: ticket.id } }),
    onSuccess: () => {
      invalidate()
      toast.success('Returned to team')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: () => softDeleteTicketFn({ data: { ticketId: ticket.id } }),
    onSuccess: () => {
      toast.success('Ticket deleted')
      router.navigate({ to: '/admin/tickets' })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const isMine = ticket.assigneePrincipalId === currentPrincipalId

  return (
    <div className="flex items-center gap-3 border-b border-border/50 px-4 py-2">
      <Button asChild variant="ghost" size="sm">
        <Link to="/admin/tickets">
          <ArrowLeftIcon className="h-4 w-4 mr-1" />
          Queue
        </Link>
      </Button>
      <div className="flex-1 min-w-0">
        <h1 className="text-sm font-semibold truncate">{ticket.subject}</h1>
        <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
          <TicketChannelIcon channel={ticket.channel as TicketChannel} className="h-3.5 w-3.5" />
          <TicketPriorityChip priority={ticket.priority as TicketPriority} />
          <span>{VISIBILITY_LABELS[ticket.visibilityScope] ?? ticket.visibilityScope}</span>
          <span>•</span>
          <span>
            updated <TimeAgo date={ticket.updatedAt} />
          </span>
        </div>
      </div>

      {isMine ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => returnMutation.mutate()}
          disabled={returnMutation.isPending}
        >
          Return
        </Button>
      ) : (
        <Button size="sm" onClick={() => takeMutation.mutate()} disabled={takeMutation.isPending}>
          Take
        </Button>
      )}

      <TicketSubscriptionMenu ticketId={ticket.id} />

      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button size="sm" variant="ghost" aria-label="Delete ticket">
            <TrashIcon className="h-4 w-4" />
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete ticket?</AlertDialogTitle>
            <AlertDialogDescription>
              This soft-deletes the ticket. It will be hidden from queues but retained in audit
              history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteMutation.mutate()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
