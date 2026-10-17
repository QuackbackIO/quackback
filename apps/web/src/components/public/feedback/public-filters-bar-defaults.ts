import type { MessageDescriptor } from 'react-intl'
import type { PostStatusEntity } from '@/lib/shared/db-types'
import { feedShowsActiveOnly } from '@/lib/shared/types/filters'

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

export const STATUS_GROUP_LABELS: Record<
  (typeof STATUS_CATEGORY_ORDER)[number],
  MessageDescriptor
> = {
  active: { id: 'portal.feedback.filter.statusGroup.active', defaultMessage: 'Active' },
  complete: { id: 'portal.feedback.filter.statusGroup.complete', defaultMessage: 'Complete' },
  closed: { id: 'portal.feedback.filter.statusGroup.closed', defaultMessage: 'Closed' },
}

/**
 * The statuses the feed shows when none are picked: the active ones, or every
 * status while searching or in a view (see feedShowsActiveOnly).
 */
export function impliedStatusSlugs(
  statuses: Pick<PostStatusEntity, 'slug' | 'category'>[],
  feed: { search?: string; view?: string }
): string[] {
  const inScope = feedShowsActiveOnly(feed)
    ? statuses.filter((s) => (s.category ?? 'active') === 'active')
    : statuses
  return inScope.map((s) => s.slug)
}
