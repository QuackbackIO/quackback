import { useContext, useEffect, useRef, useState } from 'react'
import { IntlContext } from 'react-intl'
import { DEFAULT_LOCALE } from '@/lib/shared/i18n'

interface TimeAgoProps {
  date: Date | string
  className?: string
  /** The compact age a dense list shows ("5m") in place of "5 minutes ago". */
  short?: boolean
  /**
   * The locale to word the label in, e.g. `'en'` for a label inside
   * English-only copy. Leave it out to use the app's language.
   */
  locale?: string
}

const SECOND = 1000
const MINUTE = 60 * SECOND
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const YEAR = 365.25 * DAY
const MONTH = YEAR / 12

// Building an Intl formatter is costly next to using one, and a list words a
// label per row, so one is kept per locale and style. The app has a handful
// of locales, so the caches stay small.
const relativeFormatters = new Map<string, Intl.RelativeTimeFormat>()
const unitFormatters = new Map<string, Intl.NumberFormat>()

function relativeFormatter(locale: string, numeric: 'always' | 'auto'): Intl.RelativeTimeFormat {
  const key = `${locale}\0${numeric}`
  let formatter = relativeFormatters.get(key)
  if (!formatter) {
    formatter = new Intl.RelativeTimeFormat(locale, { numeric })
    relativeFormatters.set(key, formatter)
  }
  return formatter
}

/** A narrow count of a unit in `locale`: "5m" in English, "5 min" in Polish. */
function unitLabel(locale: string, unit: 'minute' | 'hour' | 'day', value: number): string {
  const key = `${locale}\0${unit}`
  let formatter = unitFormatters.get(key)
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, { style: 'unit', unit, unitDisplay: 'narrow' })
    unitFormatters.set(key, formatter)
  }
  return formatter.format(value)
}

/** "now" in `locale`: "jetzt", "teraz", "maintenant". */
function nowLabel(locale: string): string {
  return relativeFormatter(locale, 'auto').format(0, 'second')
}

function toDate(date: Date | string | null | undefined): Date | null {
  if (!date) return null
  const d = typeof date === 'string' ? new Date(date) : date
  return isNaN(d.getTime()) ? null : d
}

/**
 * The count and unit a label names for a distance in milliseconds (negative
 * for the past), rounded to the unit that reads naturally: 50 minutes is
 * "1 hour", 25 days is "25 days" and 27 days "1 month". Null under 45
 * seconds, which reads as "now".
 */
function relativeParts(ms: number): [number, Intl.RelativeTimeFormatUnit] | null {
  const abs = Math.abs(ms)
  const count = (unit: number) => Math.sign(ms) * Math.max(1, Math.round(abs / unit))
  if (abs < 45 * SECOND) return null
  if (abs < 45 * MINUTE) return [count(MINUTE), 'minute']
  if (abs < 22 * HOUR) return [count(HOUR), 'hour']
  if (abs < 26 * DAY) return [count(DAY), 'day']
  if (abs < 320 * DAY) return [count(MONTH), 'month']
  return [count(YEAR), 'year']
}

/** The relative-time label `<TimeAgo>` renders ("3 days ago", "in 2 hours"),
 *  in `locale`, for static (no-interval) consumers like CitationFreshness;
 *  '' for a missing or invalid date. */
export function getTimeAgo(
  date: Date | string | null | undefined,
  locale: string = DEFAULT_LOCALE
): string {
  const d = toDate(date)
  if (!d) return ''
  const parts = relativeParts(d.getTime() - Date.now())
  return parts ? relativeFormatter(locale, 'always').format(...parts) : nowLabel(locale)
}

/** The compact age `<TimeAgo short>` renders, in `locale`: "now", "5m", "3h",
 *  "2d" in English; '' for a missing or invalid date. */
export function getShortTimeAgo(
  date: Date | string | null | undefined,
  locale: string = DEFAULT_LOCALE
): string {
  const d = toDate(date)
  if (!d) return ''
  const m = Math.floor((Date.now() - d.getTime()) / MINUTE)
  if (m < 1) return nowLabel(locale)
  if (m < 60) return unitLabel(locale, 'minute', m)
  const h = Math.floor(m / 60)
  if (h < 24) return unitLabel(locale, 'hour', h)
  return unitLabel(locale, 'day', Math.floor(h / 24))
}

/**
 * A relative time ("3 days ago") in the app's language: the locale of the
 * surrounding IntlProvider, which the server resolves and sends with the
 * document, or English outside a provider. Refreshes every minute.
 */
export function TimeAgo({ date, className, short = false, locale }: TimeAgoProps) {
  const appLocale = useContext(IntlContext)?.locale
  const lang = locale ?? appLocale ?? DEFAULT_LOCALE
  const getLabel = short ? getShortTimeAgo : getTimeAgo
  // Initialize with computed value for SSR
  const [timeAgo, setTimeAgo] = useState<string>(() => getLabel(date, lang))
  // The server's label and the hydrating browser's can straddle a boundary
  // ("44 minutes ago", "1 hour ago"). Hydration keeps the server's text
  // without complaint, and a changed key replaces it once mounted.
  const [remount, setRemount] = useState(0)
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    // Update immediately in case server/client time differs slightly
    const label = getLabel(date, lang)
    setTimeAgo(label)
    if (ref.current && ref.current.textContent !== label) setRemount((n) => n + 1)

    // Update every minute
    const interval = setInterval(() => {
      setTimeAgo(getLabel(date, lang))
    }, 60000)

    return () => clearInterval(interval)
  }, [date, getLabel, lang])

  return (
    <span key={remount} ref={ref} className={className} suppressHydrationWarning>
      {timeAgo}
    </span>
  )
}
