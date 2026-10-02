import { useContext, useMemo, useSyncExternalStore } from 'react'
import { IntlContext } from 'react-intl'
import { normalizeLocale } from '@/lib/shared/i18n'
import { parseCalendarDate } from '@/lib/shared/utils/date'

/**
 * Absolute dates ("Oct 1, 2026", "3:04 PM") that hydrate cleanly, in the
 * app's language.
 *
 * A date formatted with the runtime's default locale and time zone reads
 * differently on the server and in the viewer's browser, and React rejects
 * the server's markup when the hydrating render disagrees with it. So the
 * first render, on the server and in the browser while it hydrates, formats
 * in UTC with a locale both sides know: the locale of the surrounding
 * IntlProvider, which the server resolves and sends with the document, or a
 * fixed one outside a provider. Once hydrated, the text switches to the
 * viewer's time zone and, within the app's language, to the viewer's own
 * regional format (see `viewerLocaleFor`). A component that mounts after
 * hydration (a client-side navigation, an opened panel) formats for the
 * viewer from its first render.
 *
 * `<LocalDate>` renders the text; `useLocalDateFormatter()` returns the
 * formatter for strings that go into props, titles and labels. Given a
 * `locale`, both renders use exactly it and only the time zone switches, for
 * a date that sits in copy of a fixed language. Render the text in a leaf
 * (`<LocalDate>`, or a small component that calls the hook), so the switch
 * re-renders that text and nothing around it.
 */

/** The locale the first render formats with outside an IntlProvider. */
export const FIRST_RENDER_LOCALE = 'en-US'
/** The time zone the first render formats in, unless the options name one. */
export const FIRST_RENDER_TIME_ZONE = 'UTC'

/** The fields `Date#toLocaleString()` shows by default: "10/1/2026, 3:04:05 PM". */
export const NUMERIC_DATE_TIME: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
}

export type DateInput = Date | string | number

/**
 * Formats a date with `Intl.DateTimeFormat` options. With no options it shows
 * the numeric date, as `Intl.DateTimeFormat` does. Returns '' for a missing or
 * invalid date.
 */
export type LocalDateFormatter = (
  date: DateInput | null | undefined,
  options?: Intl.DateTimeFormatOptions,
  locale?: string
) => string

// Building an Intl.DateTimeFormat is costly next to using one, and a list
// formats the same options once per row. Only the first-render formatters are
// kept: their locale and zone are explicit, while the viewer's follow the
// runtime's defaults, which a kept formatter would pin.
const firstRenderFormatters = new Map<string, Intl.DateTimeFormat>()

function firstRenderFormatter(options: Intl.DateTimeFormatOptions, locale: string) {
  const key = `${locale}\0${JSON.stringify(options)}`
  let formatter = firstRenderFormatters.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, {
      ...options,
      timeZone: options.timeZone ?? FIRST_RENDER_TIME_ZONE,
    })
    firstRenderFormatters.set(key, formatter)
  }
  return formatter
}

function toDate(date: DateInput | null | undefined): Date | null {
  if (date === null || date === undefined || date === '') return null
  const parsed = date instanceof Date ? date : new Date(date)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/**
 * Formats as the first render does: `locale` or the fixed first-render
 * locale, in UTC unless `options` names a zone.
 */
export const formatFirstRenderDate: LocalDateFormatter = (date, options = {}, locale) => {
  const parsed = toDate(date)
  if (!parsed) return ''
  return firstRenderFormatter(options, locale ?? FIRST_RENDER_LOCALE).format(parsed)
}

/**
 * Formats for the viewer: `locale` or the runtime's, in the runtime's zone
 * unless `options` names one.
 */
export const formatViewerDate: LocalDateFormatter = (date, options = {}, locale) => {
  const parsed = toDate(date)
  if (!parsed) return ''
  return new Intl.DateTimeFormat(locale, options).format(parsed)
}

const subscribe = () => () => {}

/**
 * False on the server and in the render that hydrates, true afterwards and in
 * anything that mounts later. The router exports the same hook; this copy
 * keeps the primitive free of the router, which many tests mock wholesale.
 */
function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  )
}

/** The browser's preferred languages, most preferred first; none on the server. */
function preferredLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return []
  if (navigator.languages?.length) return navigator.languages
  return navigator.language ? [navigator.language] : []
}

/**
 * The locale a hydrated date formats with when the app renders in
 * `appLocale`: the first of the viewer's preferred languages that is a
 * regional form of it, so an English page reads "1 Oct 2026" for a viewer who
 * prefers en-GB, else `appLocale` itself. A viewer whose browser prefers
 * another language altogether still reads dates in the page's language.
 */
export function viewerLocaleFor(
  appLocale: string,
  preferred: readonly string[] = preferredLanguages()
): string {
  const language = normalizeLocale(appLocale)
  if (!language) return appLocale
  return preferred.find((tag) => normalizeLocale(tag) === language) ?? appLocale
}

/**
 * The date formatter for this render: the first-render format until hydrated,
 * then the viewer's. Inside an IntlProvider both are in the app's language;
 * with a `locale`, both use exactly it and only the zone switches.
 */
export function useLocalDateFormatter(locale?: string): LocalDateFormatter {
  const hydrated = useHydrated()
  const appLocale = useContext(IntlContext)?.locale
  return useMemo<LocalDateFormatter>(() => {
    const base = hydrated ? formatViewerDate : formatFirstRenderDate
    const fixed = locale ?? (appLocale && (hydrated ? viewerLocaleFor(appLocale) : appLocale))
    return fixed ? (date, options) => base(date, options, fixed) : base
  }, [hydrated, locale, appLocale])
}

interface LocalDateProps {
  date: DateInput | null | undefined
  /** `Intl.DateTimeFormat` options, e.g. `{ month: 'short', day: 'numeric', year: 'numeric' }`. */
  options?: Intl.DateTimeFormatOptions
  /**
   * A locale both renders use exactly, e.g. `'en-US'` for a date inside
   * English-only copy; only the zone then switches. Leave it out to format in
   * the app's language.
   */
  locale?: string
  className?: string
}

/** An absolute date as a `<time>` element; renders nothing for a missing or invalid date. */
export function LocalDate({ date, options, locale, className }: LocalDateProps) {
  const format = useLocalDateFormatter(locale)
  const parsed = toDate(date)
  if (!parsed) return null
  return (
    <time dateTime={parsed.toISOString()} className={className}>
      {format(parsed, options)}
    </time>
  )
}

/**
 * A date-only value ("2026-10-01") as the day it names, for every viewer: read
 * as the UTC midnight that names it and formatted in UTC, so no zone moves it
 * to a neighbouring day. A value that is not a calendar date shows as given.
 */
export function CalendarDate({
  value,
  options,
  locale,
  className,
}: {
  value: string
  options?: Intl.DateTimeFormatOptions
  locale?: string
  className?: string
}) {
  const date = parseCalendarDate(value)
  if (!date) return <>{value}</>
  return (
    <LocalDate
      date={date}
      options={{ ...options, timeZone: 'UTC' }}
      locale={locale}
      className={className}
    />
  )
}
