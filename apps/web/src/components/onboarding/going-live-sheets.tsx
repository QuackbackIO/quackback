import { lazy, Suspense, useEffect, useState } from 'react'
import { OPEN_GOING_LIVE_EVENT, type GoingLiveSheet } from './going-live-events'

// Each sheet loads on its first open, so no admin page pays for them up front.
const InstallMessengerSheet = lazy(() =>
  import('./install-messenger-sheet').then((m) => ({ default: m.InstallMessengerSheet }))
)
const InviteTeamSheet = lazy(() =>
  import('./invite-team-sheet').then((m) => ({ default: m.InviteTeamSheet }))
)

/** The Try Messenger sheet's open event (see `try-messenger-button`). */
export const OPEN_TRY_MESSENGER_EVENT = 'quackback:open-try-messenger'

/** Read and strip an email deep link's `open` / `try` parameters. */
export function consumeSetupLink(href: string): {
  open: GoingLiveSheet | null
  test: 'message' | 'idea' | null
  rest: string
} | null {
  const url = new URL(href)
  const open = url.searchParams.get('open')
  const test = url.searchParams.get('try')
  if (!open && !test) return null
  url.searchParams.delete('open')
  url.searchParams.delete('try')
  return {
    open: open === 'install-messenger' || open === 'invite-team' ? open : null,
    test: test === 'message' || test === 'idea' ? test : null,
    rest: `${url.pathname}${url.search}${url.hash}`,
  }
}

/** The admin layout's going-live sheets, opened by `openGoingLiveSheet`. */
export function GoingLiveSheets() {
  const [state, setState] = useState<{ sheet: GoingLiveSheet; open: boolean } | null>(null)
  useEffect(() => {
    const onOpen = (event: Event) => {
      const sheet = (event as CustomEvent<unknown>).detail
      if (sheet === 'install-messenger' || sheet === 'invite-team') setState({ sheet, open: true })
    }
    window.addEventListener(OPEN_GOING_LIVE_EVENT, onOpen)
    // Setup emails link straight to a step (`?open=`) or a test (`?try=`).
    const link = consumeSetupLink(window.location.href)
    if (link) {
      window.history.replaceState(window.history.state, '', link.rest)
      if (link.open) setState({ sheet: link.open, open: true })
      // After this commit: the Try Messenger host wraps the page and
      // registers its listener in an effect that runs after this one.
      const test = link.test
      if (test) {
        window.setTimeout(() =>
          window.dispatchEvent(new CustomEvent(OPEN_TRY_MESSENGER_EVENT, { detail: test }))
        )
      }
    }
    // The link is consumed once, so a re-run (Strict Mode) must not cancel it.
    return () => window.removeEventListener(OPEN_GOING_LIVE_EVENT, onOpen)
  }, [])
  if (!state) return null
  const onOpenChange = (open: boolean) => setState((prev) => prev && { ...prev, open })
  return (
    <Suspense fallback={null}>
      {state.sheet === 'install-messenger' ? (
        <InstallMessengerSheet open={state.open} onOpenChange={onOpenChange} />
      ) : (
        <InviteTeamSheet open={state.open} onOpenChange={onOpenChange} />
      )}
    </Suspense>
  )
}
