import { useEffect } from 'react'

/**
 * Warm the widget's lazy view chunks once the widget is in front of someone,
 * so a tab click resolves from cache instead of the network.
 *
 * Embedded by the SDK, the widget is a hidden iframe that the host page
 * preloads on every page view and shows only when the visitor opens it.
 * Warming there would download every view for visitors who never open the
 * widget, so a framed widget waits for the host's first `quackback:open` (or
 * any interaction, for a frame shown without the SDK). A top-level document is
 * already on screen and warms right away. Either way the fetches wait for an
 * idle moment so they never compete with first paint.
 */
export function useWarmLazyViews(loaders: readonly (() => Promise<unknown>)[]): void {
  useEffect(() => {
    let started = false
    let idleHandle: number | undefined
    let timer: number | undefined

    const warm = () => {
      for (const load of loaders) void load().catch(() => {})
    }
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent) return
      if ((event.data as { type?: unknown } | null)?.type === 'quackback:open') start()
    }
    const detach = () => {
      window.removeEventListener('message', onMessage)
      window.removeEventListener('pointerdown', start)
      window.removeEventListener('keydown', start)
    }
    function start() {
      if (started) return
      started = true
      detach()
      if (typeof window.requestIdleCallback === 'function') {
        idleHandle = window.requestIdleCallback(warm, { timeout: 3000 })
      } else {
        timer = window.setTimeout(warm, 1500)
      }
    }

    if (window.parent === window) {
      start()
    } else {
      window.addEventListener('message', onMessage)
      window.addEventListener('pointerdown', start)
      window.addEventListener('keydown', start)
    }
    return () => {
      detach()
      if (idleHandle !== undefined) window.cancelIdleCallback(idleHandle)
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [loaders])
}
