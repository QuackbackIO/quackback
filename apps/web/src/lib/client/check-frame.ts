/**
 * The frame the check after a brand match reads: the page the match changes
 * (Home), laid out at the screenshots' width, off screen, so the builder's
 * canvas stays on the page someone is looking at and nothing on screen
 * jumps. The portal's sizes are fluid and reach the measured size at 1440px
 * (tune.ts), so reading the canvas's 1280px frame drew headlines 11% small.
 *
 * The design travels in by message, as it does into the canvas: once the
 * portal says it is ready (and again after any reload), and each design the
 * check shows after that. Opening waits for the page's data to draw, since
 * a post list still loading is a blank the critic would score.
 */

/** The size the screenshots are read at (the X0 captures and the rig's fingerprints). */
export const CHECK_VIEWPORT = { width: 1440, height: 900 } as const

export interface CheckFrame<D> {
  frame: () => HTMLIFrameElement | null
  /** Draws a design in the frame. */
  show: (design: D) => void
  close: () => void
}

const pause = (ms: number) => new Promise<void>((done) => setTimeout(done, ms))

/** Whether the page has drawn its data: no skeleton, pulse or busy region left. */
export function contentDrawn(doc: Document): boolean {
  return !doc.querySelector('[data-slot=skeleton], .animate-pulse, [aria-busy=true]')
}

/** Waits (up to `most`) for the frame's fonts and data, and its page to stop growing. */
export async function settleContent(
  frame: HTMLIFrameElement,
  { most = 5000, beat = 150 }: { most?: number; beat?: number } = {}
): Promise<void> {
  const began = Date.now()
  let last = -1
  while (Date.now() - began < most) {
    const doc = frame.contentDocument
    if (doc) {
      await doc.fonts?.ready
      const size = doc.getElementsByTagName('*').length
      if (contentDrawn(doc) && size === last) return
      last = size
    }
    await pause(beat)
  }
}

export function openCheckFrame<D>({
  src,
  design,
  timeoutMs = 10_000,
  settle = settleContent,
}: {
  /** The page's preview address (the canvas's own, for Home). */
  src: string
  /** The draft design, posted whole: the frame reads it as the canvas does. */
  design: D
  timeoutMs?: number
  settle?: (frame: HTMLIFrameElement) => Promise<void>
}): Promise<CheckFrame<D>> {
  const frame = document.createElement('iframe')
  frame.setAttribute('data-brand-check', '')
  frame.setAttribute('aria-hidden', 'true')
  frame.tabIndex = -1
  frame.title = 'Brand match check'
  Object.assign(frame.style, {
    position: 'fixed',
    top: '0px',
    left: `-${CHECK_VIEWPORT.width + 200}px`,
    width: `${CHECK_VIEWPORT.width}px`,
    height: `${CHECK_VIEWPORT.height}px`,
    border: '0',
    pointerEvents: 'none',
  })
  frame.src = src
  let latest = design
  const post = () =>
    frame.contentWindow?.postMessage(
      { type: 'quackback:preview-design', design: latest },
      window.location.origin
    )
  let isReady: (() => void) | null = null
  const readyOnce = new Promise<void>((done) => {
    isReady = done
  })
  const onMessage = (event: MessageEvent) => {
    if (event.origin !== window.location.origin || event.source !== frame.contentWindow) return
    if ((event.data as { type?: string } | null)?.type !== 'quackback:preview-ready') return
    post()
    isReady?.()
  }
  window.addEventListener('message', onMessage)
  document.body.appendChild(frame)
  const close = () => {
    window.removeEventListener('message', onMessage)
    frame.remove()
  }
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<never>((_, fail) => {
    timer = setTimeout(() => fail(new Error('The check’s page was not ready in time.')), timeoutMs)
  })
  return Promise.race([readyOnce, late])
    .then(() => settle(frame))
    .then(
      () => ({
        frame: () => frame,
        show: (next: D) => {
          latest = next
          post()
        },
        close,
      }),
      (err: unknown) => {
        close()
        throw err
      }
    )
    .finally(() => clearTimeout(timer))
}
