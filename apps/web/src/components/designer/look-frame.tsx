import { useCallback, useEffect, useRef, useState } from 'react'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { cn } from '@/lib/shared/utils'
import type { LooksKit } from './looks-kit'

/** No structural draft: the frame draws everything from the design. */
const NO_STRUCTURE = {}

/**
 * One look's Home, in a same-origin frame laid out at a true width and
 * scaled. The frame loads once and keeps its page: a new design, light or
 * dark, a new width or scale reaches it in place, so switching looks, views,
 * devices or zoom loads nothing. Its page scrolls inside it; where to is
 * reported and set from outside, so the looks stay on the same part of the
 * page. A click on the page picks the look, as a click on its card does.
 */
export function LookFrame({
  kit,
  name,
  design,
  width,
  scale,
  height,
  theme,
  locale,
  onPick,
  onEscape,
  onScroll,
  frameRef,
}: {
  kit: Pick<LooksKit, 'usePreviewPosting' | 'PREVIEW_THEME' | 'canvasSrc'>
  /** What the frame is named, after its look. */
  name: string
  design: PortalDesign
  /** The width the page is laid out at, before it is scaled. */
  width: number
  scale: number
  /** The height the page is laid out at, before it is scaled. */
  height: number
  theme: 'light' | 'dark'
  locale: string
  onPick: () => void
  onEscape: () => void
  /** The page scrolled to `top`, in its own pixels. */
  onScroll: (top: number) => void
  /** The frame element, for setting where its page is scrolled to. */
  frameRef?: (frame: HTMLIFrameElement | null) => void
}) {
  const iframe = useRef<HTMLIFrameElement | null>(null)
  const setFrame = useCallback(
    (element: HTMLIFrameElement | null) => {
      iframe.current = element
      frameRef?.(element)
    },
    [frameRef]
  )
  const { usePreviewPosting, PREVIEW_THEME, canvasSrc } = kit
  // Loaded once, in the theme it opened in: later themes are sent to the page.
  const [src] = useState(() =>
    canvasSrc({ page: 'home', theme, locale, sort: 'trending', visitor: 'out' })
  )
  const shownTheme = useRef(theme)
  shownTheme.current = theme
  const onReady = useCallback((target: Window) => {
    target.postMessage(
      { type: 'quackback:preview-designer', trying: false },
      window.location.origin
    )
    target.postMessage({ type: PREVIEW_THEME, theme: shownTheme.current }, window.location.origin)
  }, [])
  usePreviewPosting(iframe, {
    draftCss: '',
    cssDirty: false,
    draft: NO_STRUCTURE,
    draftDirty: false,
    design,
    onReady,
    paced: true,
  })
  useEffect(() => {
    iframe.current?.contentWindow?.postMessage(
      { type: PREVIEW_THEME, theme },
      window.location.origin
    )
  }, [theme])

  // Until the page says it drew this look, a plain cover in its place.
  const [drawn, setDrawn] = useState(false)
  const handlers = useRef({ onPick, onEscape, onScroll })
  handlers.current = { onPick, onEscape, onScroll }
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (
        event.origin !== window.location.origin ||
        !iframe.current ||
        event.source !== iframe.current.contentWindow
      )
        return
      const message = event.data as Record<string, unknown> | null
      if (message?.type === 'quackback:preview-drawn') setDrawn(true)
      else if (message?.type === 'quackback:preview-section') handlers.current.onPick()
      else if (message?.type === 'quackback:preview-key' && message.key === 'escape')
        handlers.current.onEscape()
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // Where the page is scrolled to, from the window of each document the frame loads.
  const watchScroll = useCallback(() => {
    const view = iframe.current?.contentWindow
    if (!view) return
    view.addEventListener('scroll', () => handlers.current.onScroll(view.scrollY), {
      passive: true,
    })
  }, [])

  const drawnSize = { width, height, transform: `scale(${scale})`, transformOrigin: 'top left' }
  return (
    <>
      <iframe
        ref={setFrame}
        src={src}
        title={`${name} look, Home`}
        // The page's own links are not stops; the look is picked with its radio.
        tabIndex={-1}
        onLoad={watchScroll}
        className="absolute top-0 left-0 border-0 bg-background"
        style={drawnSize}
      />
      <div
        aria-hidden="true"
        data-look-cover=""
        className={cn(
          'pointer-events-none absolute top-0 left-0 bg-muted transition-opacity duration-150 motion-reduce:transition-none',
          drawn && 'invisible opacity-0'
        )}
        style={drawnSize}
      />
    </>
  )
}
