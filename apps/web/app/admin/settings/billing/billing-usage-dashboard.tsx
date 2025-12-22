import { Progress } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { SEAT_PRICING, type PricingTier } from '@quackback/domain/features'

interface UsageDashboardProps {
  usage: {
    boards: number
    posts: number
    /** Billable seats (owner + admin roles only) */
    seats: number
  }
  limits: {
    boards: number | 'unlimited'
    posts: number | 'unlimited'
    seats: number | 'unlimited'
    roadmaps?: number | 'unlimited'
  }
  tier: PricingTier
}

interface UsageRowProps {
  label: string
  current: number
  limit: number | 'unlimited'
}

function UsageRow({ label, current, limit }: UsageRowProps) {
  const isUnlimited = limit === 'unlimited'
  const percentage = isUnlimited ? 0 : Math.min((current / limit) * 100, 100)
  const isWarning = !isUnlimited && percentage >= 70
  const isCritical = !isUnlimited && percentage >= 95

  return (
    <div className="flex items-center gap-4 py-3">
      <span className="text-sm text-muted-foreground w-32 shrink-0">{label}</span>
      <div className="flex-1">
        <Progress
          value={isUnlimited ? 100 : current}
          max={isUnlimited ? 100 : (limit as number)}
          className={cn(
            'h-2',
            isCritical && '[&>div]:bg-red-500',
            isWarning && !isCritical && '[&>div]:bg-amber-500',
            isUnlimited && '[&>div]:bg-primary/30'
          )}
        />
      </div>
      <span
        className={cn(
          'text-sm tabular-nums w-24 text-right',
          isCritical
            ? 'text-red-600 font-medium'
            : isWarning
              ? 'text-amber-600'
              : 'text-muted-foreground'
        )}
      >
        {current.toLocaleString()} / {isUnlimited ? '∞' : limit.toLocaleString()}
      </span>
    </div>
  )
}

export function BillingUsageDashboard({ usage, limits, tier }: UsageDashboardProps) {
  // Calculate extra seats for paid tiers
  const includedSeats = limits.seats === 'unlimited' ? Infinity : limits.seats
  const extraSeats = Math.max(0, usage.seats - includedSeats)
  const seatPrice = tier !== 'free' ? SEAT_PRICING[tier as Exclude<PricingTier, 'free'>] : 0
  const extraSeatsCost = extraSeats * seatPrice

  return (
    <div className="rounded-xl border border-border/50 bg-card shadow-sm">
      <div className="px-6 py-4 border-b border-border/50">
        <h2 className="font-medium">Plan Usage</h2>
      </div>
      <div className="px-6 divide-y divide-border/50">
        <UsageRow label="Boards" current={usage.boards} limit={limits.boards} />
        <UsageRow label="Posts" current={usage.posts} limit={limits.posts} />
        <UsageRow label="Seats" current={usage.seats} limit={limits.seats} />
      </div>
      {/* Show extra seat charges if applicable */}
      {extraSeats > 0 && tier !== 'free' && (
        <div className="px-6 py-4 border-t border-border/50 bg-muted/30">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Extra seats: {extraSeats} × ${seatPrice}/seat/mo
            </span>
            <span className="font-medium">+${extraSeatsCost}/mo</span>
          </div>
        </div>
      )}
    </div>
  )
}
