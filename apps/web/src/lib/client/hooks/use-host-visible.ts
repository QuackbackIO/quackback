import { useEffect, useState } from 'react'

/**
 * Sent by a host page to its Messenger frame when it shows the frame again
 * after hiding it (a tab, a collapsed pane). A hidden frame can miss live
 * updates, so the frame catches up when it is seen.
 */
export const HOST_VISIBLE_MESSAGE = 'quackback:visible'

/** How many times the host has shown this frame again; 0 until it first does. */
export function useHostVisibleCount(): number {
  const [count, setCount] = useState(0)
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.source !== window.parent) return
      const data = event.data as { type?: unknown } | null
      if (data?.type === HOST_VISIBLE_MESSAGE) setCount((n) => n + 1)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])
  return count
}
