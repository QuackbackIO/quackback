import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { RawIntlProvider, useIntl, type IntlShape } from 'react-intl'
import { DEFAULT_LOCALE, loadMessages, type SupportedLocale } from '@/lib/shared/i18n'
import { DEFAULT_PORTAL_WORDS, type PortalWords } from '@/lib/shared/design/view'

/**
 * Shared hook that loads the message catalog for a locale (used by
 * PortalIntlProvider and WidgetAuthProvider). It does NOT touch `<html lang>`/
 * `dir`: the root document owns those reactively (see `documentLocale`), so
 * only one place decides the document language. The widget, a separate iframe
 * document with its own runtime locale, sets its own `lang`/`dir`.
 *
 * Pass `initialMessages` (loaded server-side and serialized into the route's
 * loader data) so SSR renders translated and the client hydrates from the same
 * catalog — without it the page renders English until the client fetch lands.
 * English needs no catalog: every message's English is in the code (the
 * default-messages guard), so an English page seeds nothing and loads nothing.
 */
export function useIntlSetup(
  locale: SupportedLocale,
  initialMessages?: Record<string, string>
): Record<string, string> {
  const hasInitial =
    locale === DEFAULT_LOCALE || (!!initialMessages && Object.keys(initialMessages).length > 0)
  const [messages, setMessages] = useState<Record<string, string>>(initialMessages ?? {})
  // The locale whose catalog is already in `messages`. When SSR seeds it we
  // skip the initial fetch (and the redundant network chunk it would pull); a
  // later locale change still loads the new catalog.
  const loadedLocale = useRef<SupportedLocale | null>(hasInitial ? locale : null)

  useEffect(() => {
    if (loadedLocale.current === locale) return
    if (locale === DEFAULT_LOCALE) {
      setMessages({})
      loadedLocale.current = locale
      return
    }
    let cancelled = false
    loadMessages(locale).then((msgs) => {
      if (!cancelled) {
        setMessages(msgs)
        loadedLocale.current = locale
      }
    })
    return () => {
      cancelled = true
    }
  }, [locale])

  return messages
}

/** The portal's words for the messages below: its design's, a draft's in the preview, else the defaults. */
const PortalWordsContext = createContext<PortalWords>(DEFAULT_PORTAL_WORDS)

/** The words the messages here select on. */
export function usePortalWords(): PortalWords {
  return useContext(PortalWordsContext)
}

/** An intl that passes `words` into every message, a call's own values first. */
export function withPortalWords(intl: IntlShape, words: PortalWords): IntlShape {
  const formatMessage = ((descriptor, values, options) =>
    intl.formatMessage(descriptor, { ...words, ...values }, options)) as IntlShape['formatMessage']
  return { ...intl, formatMessage, $t: formatMessage }
}

/**
 * Passes the portal's words into every message below: `words` when given, else
 * those of the tree above. Messages that name a post or a board select on them,
 * so each provider that makes an intl of its own renders this inside it.
 */
export function PortalWordsIntl({ words, children }: { words?: PortalWords; children: ReactNode }) {
  const intl = useIntl()
  const inherited = useContext(PortalWordsContext)
  const chosen = words ?? inherited
  const value = useMemo(() => withPortalWords(intl, chosen), [intl, chosen])
  const tree = createElement(RawIntlProvider, { value }, children)
  return words ? createElement(PortalWordsContext.Provider, { value: words }, tree) : tree
}
