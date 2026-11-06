import { defineMessages, type IntlShape } from 'react-intl'
import { format } from 'date-fns'
import type { ManagedApiKey } from '@/lib/server/domains/api-keys/api-key.types'

const m = defineMessages({
  removed: { id: 'apiKeys.creator.removed', defaultMessage: '{name} (removed)' },
  removedTeammate: { id: 'apiKeys.creator.removedTeammate', defaultMessage: 'Removed teammate' },
})

/** "Priya Shah", "Sam Cole (removed)" once they left, or "Removed teammate". */
export function creatorLabel(
  intl: IntlShape,
  key: Pick<ManagedApiKey, 'creatorName' | 'creatorIsTeammate'>
): string {
  if (!key.creatorName) return intl.formatMessage(m.removedTeammate)
  if (!key.creatorIsTeammate) return intl.formatMessage(m.removed, { name: key.creatorName })
  return key.creatorName
}

/** "23 Oct" */
export function shortDate(date: Date | string): string {
  return format(new Date(date), 'd MMM')
}

/** "4 Feb 2027" */
export function longDate(date: Date | string): string {
  return format(new Date(date), 'd MMM yyyy')
}
