/**
 * Right-panel "Shares" tab. Lists current cross-team shares of the ticket and
 * lets a user with `ticket.share_cross_team` add or revoke shares.
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { TicketId, TeamId, TicketShareId } from '@quackback/ids'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { XMarkIcon } from '@heroicons/react/24/outline'
import { TeamPicker } from '@/components/admin/shared/team-picker'
import { shareTicketFn, revokeShareFn } from '@/lib/server/functions/tickets'
import { ticketQueries } from '@/lib/client/queries/tickets'
import { toast } from 'sonner'

const ACCESS_LEVELS = ['read', 'comment', 'full'] as const
type AccessLevel = (typeof ACCESS_LEVELS)[number]

export interface ShareRow {
  id: TicketShareId
  ticketId: TicketId
  teamId: TeamId
  accessLevel: AccessLevel | string
}

export interface TicketSharesPanelProps {
  ticketId: TicketId
  shares: ShareRow[]
  teamNames?: Record<string, string>
  canShare: boolean
}

export function TicketSharesPanel({
  ticketId,
  shares,
  teamNames,
  canShare,
}: TicketSharesPanelProps) {
  const qc = useQueryClient()
  const [teamId, setTeamId] = useState<TeamId | null>(null)
  const [accessLevel, setAccessLevel] = useState<AccessLevel>('read')

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ticketQueries.shares(ticketId).queryKey })

  const addMutation = useMutation({
    mutationFn: () => shareTicketFn({ data: { ticketId, teamId: teamId!, accessLevel } }),
    onSuccess: () => {
      setTeamId(null)
      invalidate()
      toast.success('Ticket shared')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const revokeMutation = useMutation({
    mutationFn: (shareId: TicketShareId) => revokeShareFn({ data: { shareId } }),
    onSuccess: () => {
      invalidate()
      toast.success('Share revoked')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="space-y-3 text-sm">
      {shares.length === 0 ? (
        <div className="text-xs text-muted-foreground">Not shared with any teams.</div>
      ) : (
        <ul className="space-y-1">
          {shares.map((s) => (
            <li key={s.id} className="flex items-center justify-between gap-2 text-xs">
              <span className="truncate">
                <span className="font-medium">{teamNames?.[s.teamId] ?? s.teamId}</span>
                <span className="text-muted-foreground ml-1">({s.accessLevel})</span>
              </span>
              {canShare && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0"
                  aria-label="Revoke share"
                  onClick={() => revokeMutation.mutate(s.id)}
                  disabled={revokeMutation.isPending}
                >
                  <XMarkIcon className="h-3.5 w-3.5" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canShare && (
        <div className="rounded border border-border/50 p-2 space-y-2">
          <TeamPicker value={teamId} onValueChange={setTeamId} placeholder="Pick team…" />
          <Select value={accessLevel} onValueChange={(v) => setAccessLevel(v as AccessLevel)}>
            <SelectTrigger className="h-7 w-full text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ACCESS_LEVELS.map((l) => (
                <SelectItem key={l} value={l}>
                  {l}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            className="w-full"
            disabled={!teamId || addMutation.isPending}
            onClick={() => addMutation.mutate()}
          >
            Share
          </Button>
        </div>
      )}
    </div>
  )
}
