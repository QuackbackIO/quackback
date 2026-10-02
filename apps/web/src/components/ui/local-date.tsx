import { useSyncExternalStore } from 'react'

/**
 * Absolute dates ("Oct 1, 2026", "3:04 PM") that hydrate cleanly.
 *
 * A date formatted with the runtime's default locale and time zone reads
 * differently on the server and in the viewer's browser, and React rejects
 * the server's markup when the hydrating render disagrees with it. So the
 * first render, on the server and in the browser while it hydrates, formats
 * with a fixed locale in UTC and both sides produce the same text. Once
 * hydrated, the text switches to the viewer's locale and time zone. A
 * component that mounts after hydration (a client-side navigation, an opened
 * panel) formats for the viewer from its first render.
 *
 * `<LocalDate>` renders the text; `useLocalDateFormatter()` returns the
 * formatter for strings that go into props, titles and labels.
 */

/** The locale the first render formats with. */
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
  options?: Intl.DateTimeFormatOptions
) => string

// Building an Intl.DateTimeFormat is costly next to using one, and a list
// formats the same options once per row. Only the first-render formatters are
// kept: their locale and zone are explicit, while the viewer's follow the
// runtime's defaults, which a kept formatter would pin.
const firstRenderFormatters = new Map<string, Intl.DateTimeFormat>()

function firstRenderFormatter(options: Intl.DateTimeFormatOptions) {
  const key = JSON.stringify(options)
  let formatter = firstRenderFormatters.get(key)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(FIRST_RENDER_LOCALE, {
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

/** Formats as the first render does: the fixed locale, in UTC unless `options` names a zone. */
export const formatFirstRenderDate: LocalDateFormatter = (date, options = {}) => {
  const parsed = toDate(date)
  if (!parsed) return ''
  return firstRenderFormatter(options).format(parsed)
}

/** Formats for the viewer: the runtime's locale, in its zone unless `options` names one. */
export const formatViewerDate: LocalDateFormatter = (date, options = {}) => {
  const parsed = toDate(date)
  if (!parsed) return ''
  return new Intl.DateTimeFormat(undefined, options).format(parsed)
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

/** The date formatter for this render: the first-render format until hydrated, then the viewer's. */
export function useLocalDateFormatter(): LocalDateFormatter {
  return useHydrated() ? formatViewerDate : formatFirstRenderDate
}

interface LocalDateProps {
  date: DateInput | null | undefined
  /** `Intl.DateTimeFormat` options, e.g. `{ month: 'short', day: 'numeric', year: 'numeric' }`. */
  options?: Intl.DateTimeFormatOptions
  className?: string
}

/** An absolute date as a `<time>` element; renders nothing for a missing or invalid date. */
export function LocalDate({ date, options, className }: LocalDateProps) {
  const format = useLocalDateFormatter()
  const parsed = toDate(date)
  if (!parsed) return null
  return (
    <time dateTime={parsed.toISOString()} className={className}>
      {format(parsed, options)}
    </time>
  )
}
