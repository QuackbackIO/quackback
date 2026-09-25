import * as React from 'react'

/**
 * Whether an overlay (menu, dialog, popover, tooltip) has opened yet.
 *
 * An overlay's content part renders no portal until the overlay first opens,
 * so the closed menus and dialogs a page holds cost only their root and
 * trigger each time the page renders. From the first open on the portal stays
 * rendered, as before, and shows and hides the popup itself.
 *
 * An uncontrolled open is recorded from the root's open-change callback into
 * an external store: the same kind of update the overlay's own state makes, so
 * the portal mounts in the render that opens the popup, whether a click, a key
 * or a hover timer opened it. A controlled `open` reaches the content through
 * context in the render that passes it.
 */
interface OpenedStore {
  subscribe: (listener: () => void) => () => void
  get: () => boolean
  open: () => void
}

function createOpenedStore(initial: boolean): OpenedStore {
  let opened = initial
  const listeners = new Set<() => void>()
  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    get: () => opened,
    open() {
      if (opened) return
      opened = true
      for (const listener of listeners) listener()
    },
  }
}

interface OverlayOpened {
  store: OpenedStore
  /** The root's controlled `open`, when it has one. */
  open: boolean
}

const OverlayOpenedContext = React.createContext<OverlayOpened | null>(null)

/**
 * For an overlay root: records opens for its content part. Returns the value
 * to provide and the open-change callback to hand the Base UI root.
 */
function useOverlayOpenedRoot<Details extends { isCanceled: boolean }>(
  open: boolean | undefined,
  defaultOpen: boolean | undefined,
  onOpenChange: ((open: boolean, details: Details) => void) | undefined
) {
  const [store] = React.useState(() => createOpenedStore(Boolean(open || defaultOpen)))

  // A controlled open is read from context below; record it so the content
  // stays rendered, and can animate out, once the prop turns false.
  React.useEffect(() => {
    if (open) store.open()
  }, [store, open])

  const value = React.useMemo<OverlayOpened>(() => ({ store, open: Boolean(open) }), [store, open])

  const handleOpenChange = (next: boolean, details: Details) => {
    onOpenChange?.(next, details)
    if (next && !details.isCanceled) store.open()
  }

  return { value, onOpenChange: handleOpenChange }
}

const alwaysOpened = () => true
const noSubscription = () => () => {}

/**
 * For an overlay's content part: false until its overlay first opens. Content
 * outside one of our roots always renders.
 */
function useOverlayOpened(): boolean {
  const context = React.useContext(OverlayOpenedContext)
  const opened = React.useSyncExternalStore(
    context?.store.subscribe ?? noSubscription,
    context?.store.get ?? alwaysOpened,
    context?.store.get ?? alwaysOpened
  )
  return context === null || context.open || opened
}

export { OverlayOpenedContext, useOverlayOpened, useOverlayOpenedRoot }
