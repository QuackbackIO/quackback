import { Link } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import {
  seatAddAvailable,
  seatInviteBlocked,
  type SeatUsage,
} from '@/components/admin/settings/team/seat-usage'

export function SeatGatePanel({ usage, onAddSeat }: { usage: SeatUsage; onAddSeat?: () => void }) {
  if (!seatInviteBlocked(usage) || usage.limit == null) return null
  const canAdd = seatAddAvailable(usage) && onAddSeat
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-[12px] text-muted-foreground">
        <span className="shrink-0">Team seats</span>
        <Progress value={usage.used} max={usage.limit} className="h-1.5 flex-1" />
        <span className="shrink-0 font-mono tabular-nums">
          {usage.used} / {usage.limit}
        </span>
      </div>
      <div className="flex items-center justify-between gap-3 rounded-[10px] border border-amber-500/30 bg-amber-500/10 p-3">
        <p className="text-[13px] leading-snug text-amber-700">
          All {usage.limit} seats are in use.{' '}
          {canAdd ? 'Add a seat to send this invitation.' : 'Upgrade to send this invitation.'}
        </p>
        {canAdd ? (
          <Button type="button" size="sm" className="shrink-0" onClick={onAddSeat}>
            Add a seat
          </Button>
        ) : (
          <Button type="button" size="sm" className="shrink-0" asChild>
            <Link
              to="/admin/settings/billing"
              search={{ checkout: undefined, billing_error: undefined }}
            >
              See plans
            </Link>
          </Button>
        )}
      </div>
    </div>
  )
}
