export const VOTE_THRESHOLDS = [
  { value: 5, label: '5+ votes' },
  { value: 10, label: '10+ votes' },
  { value: 25, label: '25+ votes' },
  { value: 50, label: '50+ votes' },
  { value: 100, label: '100+ votes' },
] as const

export const DATE_PRESETS = [
  { value: 'today', label: 'Today', daysAgo: 0 },
  { value: '7days', label: 'Last 7 days', daysAgo: 7 },
  { value: '30days', label: 'Last 30 days', daysAgo: 30 },
  { value: '90days', label: 'Last 90 days', daysAgo: 90 },
] as const

export type DatePresetValue = (typeof DATE_PRESETS)[number]['value']

/**
 * Format a Date as YYYY-MM-DD from its local calendar fields.
 *
 * Deliberately not `toIsoDateOnly`, which serializes through UTC. A preset is a
 * calendar range someone picked in their own timezone, so both the arithmetic
 * and the formatting have to stay local. Routing it through UTC shifts the
 * result a day forward for negative offsets in the evening, and a day back for
 * positive offsets in the morning.
 */
function toLocalIsoDateOnly(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function getDateFromDaysAgo(days: number): string {
  const date = new Date()
  // Normalize before subtracting so the result is a whole number of calendar
  // days back from today, independent of the current time of day.
  date.setHours(0, 0, 0, 0)
  if (days > 0) {
    date.setDate(date.getDate() - days)
  }
  return toLocalIsoDateOnly(date)
}
