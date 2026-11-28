/**
 * Hands each admin route the strings of its areas. A route's loader spreads
 * `seedAdminAreas` into its data (`areaMessages`), and this wraps the page the layout
 * renders, so the route and everything inside it read them; the shell around
 * it (rail, menus, the entity modals) never does. See `AREA_MESSAGE_PREFIXES`.
 */
import { useMemo, type ReactNode } from 'react'
import { IntlProvider, useIntl } from 'react-intl'
import { useMatches } from '@tanstack/react-router'

/** The strings every matched route seeded, merged; empty when none did. */
export function mergeSeededAreas(loaderData: readonly unknown[]): Record<string, string> {
  const merged: Record<string, string> = {}
  for (const data of loaderData) {
    const seeded = (data as { areaMessages?: Record<string, string> } | undefined)?.areaMessages
    if (seeded) Object.assign(merged, seeded)
  }
  return merged
}

export function AdminAreaMessages({ children }: { children: ReactNode }) {
  const intl = useIntl()
  // Structural sharing keeps the same object while the seeded strings are
  // equal, so a navigation inside an area does not re-render the page for it.
  const seeded = useMatches({
    select: (matches) => mergeSeededAreas(matches.map((match) => match.loaderData)),
    structuralSharing: true,
  })
  // The app's catalogs are plain strings, never precompiled messages.
  const pageMessages = intl.messages as Record<string, string>
  const messages = useMemo(
    () => (Object.keys(seeded).length === 0 ? pageMessages : { ...pageMessages, ...seeded }),
    [pageMessages, seeded]
  )
  // Always the same provider, seeded or not, so moving between a page with an
  // area and one without keeps the tree and its state.
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
