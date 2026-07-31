/**
 * Pure new-conversation volume aggregation for the support analytics panel.
 * Kept separate from the SQL so the bucketing (per-UTC-day x channel, zero-filled
 * across the whole period) is unit-tested directly. Conversation volume is low,
 * so the caller selects the created rows for the period with a plain query and
 * hands them here — no rollup table needed.
 *
 * The channel dimension is the conversation's ARRIVAL source
 * (conversations.source: 'widget', 'email', 'ticket_form', ...), never the
 * mutable current-channel column, so a thread that moved surfaces still counts
 * toward the channel it arrived on.
 */

export interface ConversationCreatedRow {
  createdAt: string | Date
  /** Inbound source discriminator (conversations.source). */
  source: string
}

export type ConversationVolumeDay = { date: string } & Record<string, string | number>

export interface ConversationVolume {
  /** Channel keys seen in the period, ordered by volume desc (stack order). */
  channels: string[]
  /** One zero-filled row per UTC day in [start, end], ascending. */
  days: ConversationVolumeDay[]
  total: number
}

const toIsoDay = (d: string | Date) => new Date(d).toISOString().slice(0, 10)

export function buildConversationVolume(
  rows: ConversationCreatedRow[],
  /** Inclusive range bounds as ISO date-only strings (YYYY-MM-DD). */
  start: string,
  end: string
): ConversationVolume {
  const byDay = new Map<string, Map<string, number>>()
  const channelTotals = new Map<string, number>()
  let total = 0

  for (const r of rows) {
    const date = toIsoDay(r.createdAt)
    if (date < start || date > end) continue
    total++
    const day = byDay.get(date) ?? new Map<string, number>()
    day.set(r.source, (day.get(r.source) ?? 0) + 1)
    byDay.set(date, day)
    channelTotals.set(r.source, (channelTotals.get(r.source) ?? 0) + 1)
  }

  const channels = [...channelTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([channel]) => channel)

  const days: ConversationVolumeDay[] = []
  // UTC-day walk keeps the axis continuous across DST and month boundaries.
  for (
    let t = Date.parse(start + 'T00:00:00Z');
    t <= Date.parse(end + 'T00:00:00Z');
    t += 86_400_000
  ) {
    const date = new Date(t).toISOString().slice(0, 10)
    const counts = byDay.get(date)
    const row: ConversationVolumeDay = { date }
    for (const channel of channels) row[channel] = counts?.get(channel) ?? 0
    days.push(row)
  }

  return { channels, days, total }
}
