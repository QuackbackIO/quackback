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

/** The quiet tag on a key that has passed its expiry. */
export function ExpiredTag({ label }: { label: string }) {
  return (
    <span className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
      {label}
    </span>
  )
}

/** Whether a key has passed its expiry: it no longer works and can only be revoked. */
export function isKeyExpired(key: { expiresAt: Date | string | null }): boolean {
  return key.expiresAt != null && new Date(key.expiresAt).getTime() <= Date.now()
}
