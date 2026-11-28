/**
 * Countdown chip for a conversation's active SLA: the nearest unmet target,
 * stepping grey → a warning tint (<15m) → a stronger, bold warning tint (<5m) → danger (overdue), or "paused"
 * while a snoozed conversation's policy pauses its clocks. Ticks every 30s and
 * renders only after mount (the label depends on "now", which would otherwise
 * differ between the SSR pass and hydration).
 */
import { useOptionalIntl } from '@/components/ui/use-optional-intl'
import { memo, useEffect, useMemo, useState } from 'react'
import { ClockIcon } from '@heroicons/react/24/outline'
import type { ConversationSlaDTO, ConversationStatus } from '@/lib/shared/conversation/types'
import { slaChipState, type SlaChipTone } from '@/lib/shared/conversation/sla'
import { cn } from '@/lib/shared/utils'
import { SLA_CHIP, SLA_TARGET_LABELS as SLA_TARGET_WORDS } from './inbox-labels'

/** Exported so other bare-countdown chips (e.g. `TicketDueChip` in
 *  inbox-detail-panel.tsx) share this exact tone → color mapping. */
export const TONE_CLASSES: Record<SlaChipTone, string> = {
  ok: 'bg-muted text-muted-foreground',
  due_soon: 'bg-warning/10 text-warning',
  due_now: 'bg-warning/20 font-semibold text-warning',
  overdue: 'bg-destructive/10 text-destructive',
  paused: 'bg-muted text-muted-foreground/70',
}

export const SlaChip = memo(function SlaChip({
  sla,
  status,
  className,
}: {
  sla: ConversationSlaDTO | null
  status: ConversationStatus
  className?: string
}) {
  const intl = useOptionalIntl()
  const [now, setNow] = useState<Date | null>(null)
  useEffect(() => {
    setNow(new Date())
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])

  const state = useMemo(
    () => (sla && now ? slaChipState(sla, status, now) : null),
    [sla, status, now]
  )
  if (!sla || !state) return null

  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium normal-case tabular-nums',
        TONE_CLASSES[state.tone],
        className
      )}
      title={intl.formatMessage(
        { id: 'admin.inbox.slaChip.targetTitle', defaultMessage: '{policy} · {target} target' },
        { policy: sla.policyName, target: intl.formatMessage(SLA_TARGET_WORDS[state.kind]) }
      )}
    >
      <ClockIcon className="h-3 w-3" aria-hidden />
      {state.tone === 'paused'
        ? intl.formatMessage(SLA_CHIP.paused)
        : state.tone === 'overdue'
          ? intl.formatMessage(SLA_CHIP.over, { time: state.time })
          : state.time}
    </span>
  )
})
