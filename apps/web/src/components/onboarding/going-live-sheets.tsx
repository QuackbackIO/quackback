import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { OPEN_GOING_LIVE_EVENT, type GoingLiveSheet } from './going-live-events'
import { SheetMessages } from './sheet-messages'

// The sheet loads on its first open, with its strings, so no admin page pays
// for it up front.
const InviteTeamSheet = lazy(() =>
  import('./invite-team-sheet').then((m) => ({ default: m.InviteTeamSheet }))
)

/** Read and strip an email deep link's `open` parameter. */
export function consumeSetupLink(href: string): {
  open: GoingLiveSheet | null
  rest: string
} | null {
  const url = new URL(href)
  const open = url.searchParams.get('open')
  if (!open) return null
  url.searchParams.delete('open')
  return {
    open: open === 'invite-team' ? open : null,
    rest: `${url.pathname}${url.search}${url.hash}`,
  }
}

/**
 * The admin layout's going-live sheet, opened by `openGoingLiveSheet`: the
 * open sheet, for the layout's sheet host to render. A hook rather than a
 * component of its own, so every admin page renders nothing more for it until
 * a sheet opens.
 */
export function useGoingLiveSheets(): ReactNode {
  const [state, setState] = useState<{ sheet: GoingLiveSheet; open: boolean } | null>(null)
  useEffect(() => {
    const onOpen = (event: Event) => {
      const sheet = (event as CustomEvent<unknown>).detail
      if (sheet === 'invite-team') setState({ sheet, open: true })
    }
    window.addEventListener(OPEN_GOING_LIVE_EVENT, onOpen)
    // Setup emails link straight to a step (`?open=`).
    const link = consumeSetupLink(window.location.href)
    if (link) {
      window.history.replaceState(window.history.state, '', link.rest)
      if (link.open) setState({ sheet: link.open, open: true })
    }
    // The link is consumed once, so a re-run (Strict Mode) must not cancel it.
    return () => window.removeEventListener(OPEN_GOING_LIVE_EVENT, onOpen)
  }, [])
  if (!state) return null
  const onOpenChange = (open: boolean) => setState((prev) => prev && { ...prev, open })
  return (
    <Suspense fallback={null}>
      <SheetMessages>
        <InviteTeamSheet open={state.open} onOpenChange={onOpenChange} />
      </SheetMessages>
    </Suspense>
  )
}
