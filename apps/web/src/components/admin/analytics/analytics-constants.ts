/**
 * Shared analytics layout constants.
 *
 * Kept free of recharts (and any heavy deps) so both the lazy-loaded chart and
 * the eagerly-rendered page/skeletons can import it without pulling recharts
 * into the page bundle.
 */

/** Hero activity-chart height. The chart, its empty state, and both loading
 *  skeletons share this so the layout never jumps between states. */
import { getChannelDescriptor } from '@/lib/shared/channels'

export const CHART_HEIGHT_CLASS = 'h-[clamp(300px,46vh,520px)]'

/** Display labels for the known conversation arrival channels
 *  (conversations.source). A source outside this map humanizes its key
 *  ('ticket_form' → 'Ticket form'). */
export const CHANNEL_LABELS: Record<string, string> = {
  widget: 'Widget',
  email: 'Email',
  ticket_form: 'Ticket form',
}

export function channelLabel(channel: string): string {
  const descriptor = getChannelDescriptor(channel)
  if (descriptor) return descriptor.label
  return (
    CHANNEL_LABELS[channel] ?? channel.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
  )
}

/** Known channels paint with their `--metric-<channel>` token (channel keys
 *  carry underscores, CSS tokens hyphens); anything else falls back to the
 *  generic chart palette by position. */
export function channelColor(channel: string, index: number): string {
  return channel in CHANNEL_LABELS
    ? `var(--metric-${channel.replace(/_/g, '-')})`
    : `var(--chart-${(index % 5) + 1})`
}

/** Compact duration for response-time stat values and tooltip rows
 *  ("45m", "2h 15m", "1.5d"). null (nothing answered in the period) renders
 *  as an em dash. */
export function formatResponseTime(minutes: number | null): string {
  if (minutes == null) return '—'
  if (minutes < 1) return '<1m'
  if (minutes < 60) return `${Math.round(minutes)}m`
  if (minutes < 1440) {
    const h = Math.floor(minutes / 60)
    const m = Math.round(minutes % 60)
    return m === 0 ? `${h}h` : `${h}h ${m}m`
  }
  return `${(minutes / 1440).toFixed(1)}d`
}
