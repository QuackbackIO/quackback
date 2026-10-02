/**
 * Stand in for another runtime's default locale and time zone, so a test can
 * render as the server (one locale and zone) and hydrate as a viewer's browser
 * (another) in the same process.
 *
 * `setRuntimeLocale('de-DE', 'Pacific/Kiritimati')` makes every date format
 * that leaves the locale or zone to the runtime (`toLocaleDateString()`,
 * `toLocaleString(undefined, ...)`, `toLocaleTimeString([], ...)`,
 * `new Intl.DateTimeFormat(undefined, ...)`) use that locale and zone. An
 * explicit locale or `timeZone` is left alone. Returns the restore function;
 * calling `setRuntimeLocale` again restores the previous stand-in first.
 */

type DateMethod = 'toLocaleString' | 'toLocaleDateString' | 'toLocaleTimeString'

const DATE_METHODS: DateMethod[] = ['toLocaleString', 'toLocaleDateString', 'toLocaleTimeString']

const RealDateTimeFormat = Intl.DateTimeFormat
const realDateMethods = Object.fromEntries(
  DATE_METHODS.map((method) => [method, Date.prototype[method]])
) as Record<DateMethod, (locales?: unknown, options?: Intl.DateTimeFormatOptions) => string>

const isRuntimeDefault = (locales: unknown) =>
  locales === undefined || (Array.isArray(locales) && locales.length === 0)

export function restoreRuntimeLocale(): void {
  Intl.DateTimeFormat = RealDateTimeFormat
  for (const method of DATE_METHODS) Date.prototype[method] = realDateMethods[method]
}

export function setRuntimeLocale(locale: string, timeZone: string): () => void {
  restoreRuntimeLocale()
  const resolve = (locales: unknown, options?: Intl.DateTimeFormatOptions) =>
    [
      isRuntimeDefault(locales) ? locale : locales,
      { ...options, timeZone: options?.timeZone ?? timeZone },
    ] as const

  function StandIn(locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
    const [l, o] = resolve(locales, options)
    return new RealDateTimeFormat(l as string | string[], o)
  }
  StandIn.prototype = RealDateTimeFormat.prototype
  StandIn.supportedLocalesOf = RealDateTimeFormat.supportedLocalesOf
  Intl.DateTimeFormat = StandIn as unknown as typeof Intl.DateTimeFormat

  for (const method of DATE_METHODS) {
    const real = realDateMethods[method]
    Date.prototype[method] = function (
      this: Date,
      locales?: unknown,
      options?: Intl.DateTimeFormatOptions
    ) {
      const [l, o] = resolve(locales, options)
      return real.call(this, l, o)
    } as (typeof Date.prototype)[DateMethod]
  }
  return restoreRuntimeLocale
}

/** Formats with an explicit locale and zone, untouched by any stand-in: a test's expected text. */
export function formatIn(
  locale: string,
  timeZone: string,
  date: Date | string,
  options: Intl.DateTimeFormatOptions = {}
): string {
  return new RealDateTimeFormat(locale, { ...options, timeZone }).format(new Date(date))
}
