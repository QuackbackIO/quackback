import { useIntl } from 'react-intl'
import { LocalDate } from '@/components/ui/local-date'

const BACK_AT: Intl.DateTimeFormatOptions = { weekday: 'long', hour: 'numeric', minute: '2-digit' }

/**
 * When the team is back, e.g. "Monday 9:00 AM": in the visitor's language,
 * and in their time zone once hydrated. Nothing for a missing or invalid time.
 */
export function BackAtTime({ at }: { at: string | null | undefined }) {
  const intl = useIntl()
  return <LocalDate date={at} options={BACK_AT} locale={intl.locale} />
}

/** Whether `at` is a time `BackAtTime` can show. */
export function hasBackAtTime(at: string | null | undefined): at is string {
  return !!at && !Number.isNaN(new Date(at).getTime())
}
