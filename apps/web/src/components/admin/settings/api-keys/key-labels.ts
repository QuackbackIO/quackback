import { defineMessages, type IntlShape } from 'react-intl'
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

/**
 * "Oct 23": a calendar day, read in UTC so the server and the browser print
 * the same text.
 */
export const SHORT_DATE: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
}

/** "Feb 4, 2027", in UTC like SHORT_DATE. */
export const LONG_DATE: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
}
