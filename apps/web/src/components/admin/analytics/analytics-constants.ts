/**
 * Shared analytics layout constants.
 *
 * Kept free of recharts (and any heavy deps) so both the lazy-loaded chart and
 * the eagerly-rendered page/skeletons can import it without pulling recharts
 * into the page bundle.
 */

/** Hero activity-chart height. The chart, its empty state, and both loading
 *  skeletons share this so the layout never jumps between states. */
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
  return (
    CHANNEL_LABELS[channel] ?? channel.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
  )
}

/** Known channels paint with their `--metric-<channel>` token; anything else
 *  falls back to the generic chart palette by position. */
export function channelColor(channel: string, index: number): string {
  return channel in CHANNEL_LABELS ? `var(--metric-${channel})` : `var(--chart-${(index % 5) + 1})`
}
