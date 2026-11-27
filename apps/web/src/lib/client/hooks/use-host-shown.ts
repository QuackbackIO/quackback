import { useSyncExternalStore } from 'react'

/**
 * Sent by a host page to its Messenger frame whenever it hides or shows the
 * frame while keeping it mounted: the embed script when its panel closes or
 * opens (as `{ type, data }`), or a page that keeps the frame in a tab (as
 * `{ type, shown }`). A hidden frame is not being read, so it leaves new
 * replies unread until it is shown again. A host that never sends it is always
 * shown.
 */
export const HOST_SHOWN_MESSAGE = 'quackback:shown'

let shown = true
const listeners = new Set<() => void>()

// Listen from module load, not from the first reader: the host can hide the
// frame before any thread is open in it.
if (typeof window !== 'undefined') {
  window.addEventListener('message', (event: MessageEvent) => {
    if (event.source !== window.parent) return
    const msg = event.data as { type?: unknown; shown?: unknown; data?: unknown } | null
    if (msg?.type !== HOST_SHOWN_MESSAGE) return
    const next = typeof msg.shown === 'boolean' ? msg.shown : msg.data
    if (typeof next !== 'boolean' || next === shown) return
    shown = next
    for (const listener of listeners) listener()
  })
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Whether the host page shows this frame; true outside a frame. */
export function useHostShown(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => shown,
    () => true
  )
}
