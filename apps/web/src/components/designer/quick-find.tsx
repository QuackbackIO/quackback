import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { trackBuilder } from '@/lib/client/builder-events'
import { useOpenedOnce } from '@/lib/client/hooks/use-opened-once'
import type { PanelAction } from '@/lib/shared/design/builder-chrome'
import type { DesignerPage, Selection } from '@/lib/shared/design/outline'
import { findIndex, type FindItem, type FindPlace, type FindSource } from './find-index'
import { FIND_ROOTS, revealRow } from './find-reveal'

// The dialog and its list (cmdk) load the first time quick find opens.
const QuickFindDialog = lazy(() =>
  import('./quick-find-dialog').then((m) => ({ default: m.QuickFindDialog }))
)

/** How quick find gets to what was chosen: the builder's own steps. */
export interface FindNavigation {
  /**
   * Shows a row's place: closes the sheets it is not in, shows its page,
   * and opens Theme at its view or picks its part.
   */
  show: (place: FindPlace) => void
  /** Picks a part, on its page. */
  pick: (selection: Selection, page: DesignerPage) => void
  page: (page: DesignerPage) => void
}

/**
 * The builder's steps for quick find: Theme opens at the view asked for;
 * any other row closes the sheets, then shows its page and picks its part
 * (nothing, for the page's own panel), or stays in the panel open now.
 */
export function builderNavigation({
  dispatch,
  page,
  setPage,
  pick,
  setSelection,
  open,
}: {
  dispatch: (action: PanelAction) => void
  page: DesignerPage
  setPage: (page: DesignerPage) => void
  pick: (selection: Selection) => void
  setSelection: (selection: Selection | null) => void
  /** Opens the properties: their column in a narrow window, and the page's panel if Escape closed it. */
  open: () => void
}): FindNavigation {
  return {
    show: (place) => {
      open()
      if (place.kind === 'theme') return dispatch({ type: 'open', sheet: 'theme', at: place.at })
      // The picked element's panel and every part's lie under the sheets.
      dispatch({ type: 'close' })
      if (place.kind === 'here') return
      if (place.page !== page) setPage(place.page)
      if (place.selection) pick(place.selection)
      else setSelection(null)
    },
    pick: (selection, on) => {
      open()
      dispatch({ type: 'close' })
      if (on !== page) setPage(on)
      pick(selection)
    },
    page: setPage,
  }
}

/**
 * Goes to what an entry finds: a row's panel, then the row itself, focused
 * and outlined; a part, picked with focus in its panel; a page; or an
 * action, done. Resolves to the control focused, where there is one.
 */
export async function followFind(
  item: FindItem,
  navigation: FindNavigation,
  /** How long to wait for a row to draw. */
  waitMs?: number
): Promise<HTMLElement | null> {
  const target = item.target
  switch (target.kind) {
    case 'page':
      navigation.page(target.page)
      return null
    case 'action':
      target.run()
      return null
    case 'part':
      navigation.pick(target.selection, target.page)
      return revealPanel()
    case 'row':
      navigation.show(target.place)
      return revealRow({
        root: target.place.kind === 'theme' ? FIND_ROOTS.theme : FIND_ROOTS.panel,
        row: target.row,
        opens: target.opens,
        waitMs,
      })
  }
}

/** Focus in the properties, once a pick has drawn them. */
function revealPanel(): Promise<HTMLElement | null> {
  return new Promise((done) =>
    requestAnimationFrame(() => {
      const panel = document.getElementById('designer-settings')
      panel?.focus()
      done(panel)
    })
  )
}

/**
 * Ctrl+K or Cmd+K, on the designer or its canvas, finds a part, a page, a
 * setting or an action by name, each shown with where it is ("Theme › Style
 * › Corners"). A setting closes what is in the way, goes to its page and
 * panel, opens what it sits under, then focuses its control and outlines it;
 * an action is done.
 */
export function QuickFind({
  source,
  navigation,
  opened,
  onOpened,
  extra,
  actions,
}: {
  /** What the index is built from: the design, the pages that are on, the page shown. */
  source: FindSource
  navigation: FindNavigation
  /** More to find, such as the picked element's own settings. */
  extra?: readonly FindItem[]
  /** The actions on offer as it opens, such as duplicating the picked block. */
  actions?: () => readonly FindItem[]
  /** Open from elsewhere, such as the More menu; it opens itself on Ctrl+K too. */
  opened?: boolean
  onOpened?: (open: boolean) => void
}) {
  const [own, setOwn] = useState(false)
  const open = opened ?? own
  const told = useRef(onOpened)
  told.current = onOpened
  const setOpen = useCallback((next: boolean) => {
    setOwn(next)
    told.current?.(next)
  }, [])
  // A setting takes focus itself, so closing does not hand it back.
  const toSetting = useRef(false)
  useEffect(() => {
    if (open) trackBuilder('designer_panel_opened', { panel: 'quick_find' })
  }, [open])
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(true)
      }
    }
    // The canvas hands its Ctrl+K over, from the canvas's own frame only.
    const onMessage = (event: MessageEvent) => {
      const message = event.data as { type?: unknown; key?: unknown } | null
      const fromCanvas =
        !!event.source &&
        [...document.querySelectorAll<HTMLIFrameElement>('[data-canvas-box] iframe')].some(
          (frame) => frame.contentWindow === event.source
        )
      if (
        event.origin === window.location.origin &&
        fromCanvas &&
        message?.type === 'quackback:preview-key' &&
        message.key === 'find'
      )
        setOpen(true)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('message', onMessage)
    }
  }, [setOpen])
  // Built while open, from the design as it is; the actions are read then too.
  const items = useMemo(
    () => (open ? [...(extra ?? []), ...findIndex(source), ...(actions?.() ?? [])] : []),
    [open, extra, actions, source]
  )
  // Nothing is drawn, or loaded, until it first opens; after that it stays, so closing can animate.
  const everOpened = useOpenedOnce(open)
  const go = useCallback(
    (item: FindItem) => {
      toSetting.current = item.target.kind === 'row' || item.target.kind === 'part'
      setOpen(false)
      void followFind(item, navigation)
    },
    [navigation, setOpen]
  )
  if (!everOpened) return null
  return (
    <Suspense fallback={null}>
      <QuickFindDialog
        open={open}
        onOpenChange={setOpen}
        items={items}
        onGo={go}
        keepFocus={toSetting}
      />
    </Suspense>
  )
}
