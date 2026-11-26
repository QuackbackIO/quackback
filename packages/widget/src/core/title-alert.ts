/**
 * The tab title flash for an unread reply: while the host page is hidden and
 * there is text to show, the title alternates between the page's own title
 * and the text. It goes back to the page's title as soon as the page is
 * visible again or the text is cleared.
 */

export interface TitleAlert {
  /** The text to flash, or null to stop. */
  set(text: string | null): void
  destroy(): void
}

export const TITLE_ALERT_INTERVAL_MS = 1500

export function createTitleAlert(): TitleAlert {
  let text: string | null = null
  // The text currently written to the title, and the page's own title.
  let shown: string | null = null
  let original = ''
  let timer = 0

  const tick = () => {
    if (shown !== null && document.title === shown) {
      document.title = original
      shown = null
      return
    }
    // A page that changed its own title in the meantime keeps the new one.
    original = document.title
    shown = text
    document.title = text ?? original
  }

  const stop = () => {
    if (!timer) return
    window.clearInterval(timer)
    timer = 0
    // Only our own text is put back; a title the page set itself stays.
    if (shown !== null && document.title === shown) document.title = original
    shown = null
  }

  const update = () => {
    const run = text !== null && document.visibilityState === 'hidden'
    if (!run) return stop()
    if (timer) return
    tick()
    timer = window.setInterval(tick, TITLE_ALERT_INTERVAL_MS)
  }

  document.addEventListener('visibilitychange', update)

  return {
    set(next) {
      const changed = next !== text
      text = next
      // New words replace the old ones at once, not a beat later.
      if (changed && timer) stop()
      update()
    },
    destroy() {
      document.removeEventListener('visibilitychange', update)
      text = null
      stop()
    },
  }
}
