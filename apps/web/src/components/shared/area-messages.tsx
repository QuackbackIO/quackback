/**
 * One area's strings, which pages leave out of the catalog they seed (see
 * `AREA_MESSAGE_PREFIXES`). An area its routes render on the server passes the
 * strings its loader read; a surface that opens on a click names its area and
 * the strings load as it opens, the way the file viewer's do.
 */
import { Suspense, use, useMemo, type ReactNode } from 'react'
import { IntlProvider, useIntl } from 'react-intl'
import {
  DEFAULT_LOCALE,
  loadAreaMessages,
  messageArea,
  normalizeLocale,
  type MessageArea,
  type SupportedLocale,
} from '@/lib/shared/i18n'

const loaded = new Map<string, Promise<Record<string, string>>>()

function areaMessagesFor(
  locale: SupportedLocale,
  area: MessageArea
): Promise<Record<string, string>> {
  const key = `${locale}:${area}`
  let pending = loaded.get(key)
  if (!pending) {
    pending = loadAreaMessages(locale, area).catch(() => ({}))
    loaded.set(key, pending)
  }
  return pending
}

/**
 * Supplies `area`'s strings to `children`. `messages` are the strings a route
 * loader read for it; without them they load here, suspending to `fallback`
 * meanwhile. A page whose catalog already holds the area (one loaded whole,
 * say) passes straight through.
 */
export function AreaMessages({
  area,
  messages,
  fallback = null,
  children,
}: {
  area: MessageArea
  messages?: Record<string, string>
  fallback?: ReactNode
  children: ReactNode
}) {
  const intl = useIntl()
  // A message's defaultMessage is its English, so English needs nothing loaded.
  if (normalizeLocale(intl.locale) === DEFAULT_LOCALE) return children
  if (Object.keys(intl.messages).some((key) => messageArea(key) === area)) return children
  if (messages) return <WithMessages extra={messages}>{children}</WithMessages>
  return (
    <Suspense fallback={fallback}>
      <LoadedAreaMessages area={area}>{children}</LoadedAreaMessages>
    </Suspense>
  )
}

function LoadedAreaMessages({ area, children }: { area: MessageArea; children: ReactNode }) {
  const intl = useIntl()
  const locale = normalizeLocale(intl.locale) ?? DEFAULT_LOCALE
  const extra = use(areaMessagesFor(locale, area))
  return <WithMessages extra={extra}>{children}</WithMessages>
}

function WithMessages({ extra, children }: { extra: Record<string, string>; children: ReactNode }) {
  const intl = useIntl()
  // The app's catalogs are plain strings, never precompiled messages.
  const pageMessages = intl.messages as Record<string, string>
  const messages = useMemo(() => ({ ...pageMessages, ...extra }), [pageMessages, extra])
  return (
    <IntlProvider
      locale={intl.locale}
      defaultLocale={intl.defaultLocale}
      messages={messages}
      onError={intl.onError}
    >
      {children}
    </IntlProvider>
  )
}
