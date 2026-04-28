import { toIsoDateOnly } from '@/lib/shared/utils'

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

export function getDateFromDaysAgo(days: number): string {
  const date = new Date()
  if (days > 0) {
    date.setDate(date.getDate() - days)
  } else {
    date.setHours(0, 0, 0, 0)
  }
  return toIsoDateOnly(date)
}
