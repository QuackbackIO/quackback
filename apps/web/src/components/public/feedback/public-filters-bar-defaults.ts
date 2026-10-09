export {
  VOTE_THRESHOLDS,
  DATE_PRESETS,
  getDateFromDaysAgo,
  type DatePresetValue,
} from '@/components/shared/filter-presets'

/** Labels live in the filters bar, worded in the app's language. */
export const RESPONDED_OPTIONS = [{ value: 'responded' }, { value: 'unresponded' }] as const

export type { RespondedFilter as RespondedValue } from '@/lib/shared/types/filters'

/**
 * Status category groups for the Status submenu.
 * Order matches the settings page (Active first, then Complete, then Closed).
 */
export const STATUS_CATEGORY_ORDER = ['active', 'complete', 'closed'] as const
