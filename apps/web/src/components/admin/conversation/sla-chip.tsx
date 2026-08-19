/**
 * Countdown chip for a conversation's active SLA: the nearest unmet target,
 * stepping grey → yellow (<15m) → orange (<5m) → red (overdue), or "paused"
 * while a snoozed conversation's policy pauses its clocks. Ticks every 30s and
 * renders only after mount (the label depends on "now", which would otherwise
 * differ between the SSR pass and hydration).
 */
import { useEffect, useMemo, useState } from 'react'
import { ClockIcon } from '@heroicons/react/24/outline'
import type { ConversationSlaDTO, ConversationStatus } from '@/lib/shared/conversation/types'
import { slaChipState, SLA_TARGET_LABELS, type SlaChipTone } from '@/lib/shared/conversation/sla'
import { cn } from '@/lib/shared/utils'

/** Exported so other bare-countdown chips (e.g. `TicketDueChip` in
 *  inbox-detail-panel.tsx) share this exact tone → color mapping. */
export const TONE_CLASSES: Record<SlaChipTone, string> = {
  ok: 'bg-muted text-muted-foreground',
  due_soon: 'bg-amber-400/15 text-amber-700 dark:text-amber-300',
  due_now: 'bg-orange-500/15 text-orange-700 dark:text-orange-400',
  overdue: 'bg-red-500/15 text-red-700 dark:text-red-400',
  paused: 'bg-muted text-muted-foreground/70',
}

export function SlaChip({
  sla,
  status,
  className,
}: {
  sla: ConversationSlaDTO | null
  status: ConversationStatus
  className?: string
}) {
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
      title={`${sla.policyName} · ${SLA_TARGET_LABELS[state.kind]} target`}
    >
      <ClockIcon className="h-3 w-3" aria-hidden />
      {state.label}
    </span>
  )
}
