/**
 * Compact countdown chip for an SLA clock. Color ramps from green (>1h to due)
 * through amber (<1h) to red (breached).
 */
import { useEffect, useState } from 'react'
import { cn } from '@/lib/shared/utils'

export type SlaClockState = 'running' | 'paused' | 'met' | 'breached' | 'cancelled'
export type SlaClockKind = 'first_response' | 'next_response' | 'resolution'

export interface SlaClockChipInput {
  kind: SlaClockKind
  state: SlaClockState
  dueAt: string | Date
  breachedAt?: string | Date | null
  metAt?: string | Date | null
}

export interface SlaClockChipProps {
  clock: SlaClockChipInput
  className?: string
  /** Show the kind label (e.g. "First response") inline. */
  showKind?: boolean
}

function formatDelta(ms: number): string {
  const abs = Math.abs(ms)
  const minutes = Math.floor(abs / 60_000)
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ${minutes % 60}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

const KIND_LABEL: Record<SlaClockKind, string> = {
  first_response: 'First response',
  next_response: 'Next response',
  resolution: 'Resolution',
}

export function SlaClockChip({ clock, className, showKind = false }: SlaClockChipProps) {
  // Re-render every 30s so countdown stays fresh.
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  const due = new Date(clock.dueAt).getTime()
  const now = Date.now()
  const remainingMs = due - now

  let label: string
  let style: string
  if (clock.state === 'met') {
    label = 'Met'
    style = 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
  } else if (clock.state === 'breached' || remainingMs < 0) {
    label = `−${formatDelta(remainingMs)}`
    style = 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200'
  } else if (clock.state === 'paused') {
    label = 'Paused'
    style = 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
  } else if (clock.state === 'cancelled') {
    label = 'Cancelled'
    style = 'bg-muted text-muted-foreground'
  } else {
    label = formatDelta(remainingMs)
    style =
      remainingMs < 60 * 60_000
        ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200'
        : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
  }

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium tabular-nums',
        style,
        className
      )}
      title={`${KIND_LABEL[clock.kind]} due ${new Date(clock.dueAt).toLocaleString()}`}
    >
      {showKind && <span className="opacity-70">{KIND_LABEL[clock.kind]}:</span>}
      {label}
    </span>
  )
}
