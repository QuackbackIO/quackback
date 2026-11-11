import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { usePreviewPosting } from '@/components/admin/settings/branding/use-preview-posting'
import type { PortalPreviewProps } from '@/components/admin/settings/branding/portal-preview'
import type { PortalPreviewDraft } from '@/components/public/preview-draft-context'
import { PAGE_NAMES, type DesignerPage } from '@/lib/shared/design/outline'
import { canvasSrc, DRAFT_DRAWN_ATTRIBUTE } from '@/lib/shared/design/canvas-src'
import { PREVIEW_NAVIGATE, PREVIEW_THEME } from '@/components/public/preview-draft-context'

export { canvasSrc }
import type { CanvasVisitor } from '@/lib/shared/design/designer-frame'
import { isMenuTarget, type MenuTarget } from '@/lib/shared/design/menu-actions'
import type { SamplePage } from '@/lib/shared/design/sample-pages'
import { isWordsDoc, type WordsDoc } from '@/lib/shared/design/rich-words'
import { readWordsField, wordsKindOf, wordsLimitOf } from '@/lib/shared/design/headline-words'
import { checkedWords } from '@/lib/shared/design/words-schema'
import { cn } from '@/lib/shared/utils'
import { PHONE_TINT } from './properties/phone-mode'

/** The widths a visitor's browser lays the portal out at: desktop, tablet and phone. */
export const CANVAS_WIDTHS = { desktop: 1280, tablet: 768, phone: 390 } as const
export type CanvasSize = keyof typeof CANVAS_WIDTHS

/** A path the frame says it is at: the portal's own, never another site's. */
function framePath(value: unknown): string | null {
  return typeof value === 'string' && /^\/(?!\/)/.test(value) && value.length <= 2048 ? value : null
}

/** How the canvas is scaled: to fit, or at a set share of its true width. */
export type CanvasZoom = 'fit' | 0.5 | 0.75 | 1

/** The scale a page of a width is drawn at in a room of a width. */
export function canvasScale(room: number, width: number, zoom: CanvasZoom): number {
  if (zoom !== 'fit') return zoom
  return room > 0 ? Math.min(1, room / width) : 1
}

/** How long a loaded page that never says it is ready keeps its skeleton. */
const LOADED_GRACE_MS = 3000

/** The frame's border, drawn outside the page so the layer over it lines up exactly. */
const FRAME_BORDER = 1

/**
 * The frame's scale and sizes in a room: `outer` is the bordered box, `room`
 * the page as drawn inside it, which is what the editing layer covers.
 */
export function frameBox(
  space: { width: number; height: number },
  width: number,
  zoom: CanvasZoom
): {
  scale: number
  height: number
  outer: { width: number; height: number }
  room: { width: number; height: number }
} {
  const edge = FRAME_BORDER * 2
  const scale = canvasScale(Math.max(0, space.width - edge), width, zoom)
  const height = space.height > edge ? (space.height - edge) / scale : 800
  const room = { width: width * scale, height: height * scale }
  return { scale, height, room, outer: { width: room.width + edge, height: room.height + edge } }
}

/** What the editing layer over the canvas is drawn from. */
export interface CanvasFrame {
  /** The frame, whose same-origin page the layer reads block boxes from. */
  frame: HTMLIFrameElement | null
  /** The scale the page is drawn at. */
  scale: number
  /** The canvas's visible size on the layer. */
  room: { width: number; height: number }
}

/**
 * Words the frame sent back: plain text, or a document checked against its
 * kind's schema and fitted if it fails, so nothing the schema refuses is kept.
 */
export function framedWords(
  message: Record<string, unknown>
): { field: string; value: WordsDoc | string } | null {
  const field = readWordsField(message.field)
  if (!field) return null
  if (isWordsDoc(message.doc))
    return {
      field: message.field as string,
      value: checkedWords(message.doc, wordsKindOf(field), wordsLimitOf(field)),
    }
  return typeof message.text === 'string'
    ? { field: message.field as string, value: message.text }
    : null
}

/**
 * Which document the canvas's frame holds for a view: one per language,
 * visitor, sample and Preview. A sample has an address of its own, and
 * Preview's links act, so each loads afresh; any other page or item is gone
 * to inside the document already loaded.
 */
export function frameDocument({
  page,
  locale,
  sort,
  postPath = null,
  visitor = 'in',
  sample = null,
  trying = false,
}: {
  page: DesignerPage
  locale: string
  sort: 'trending' | 'top' | 'new'
  postPath?: string | null
  visitor?: CanvasVisitor
  sample?: SamplePage | null
  trying?: boolean
}): string {
  if (sample || trying)
    return `${canvasSrc({ page, theme: 'light', locale, sort, postPath, visitor, sample })}|${trying}`
  return `portal|${locale}|${visitor}`
}

/** No structural draft: the canvas draws everything, the welcome message too, from the design. */
export const NO_STRUCTURE: PortalPreviewDraft = {}

/**
 * The page being designed, in a same-origin frame laid out at a true width
 * and scaled down to fit. The draft travels in by message; clicks, the
 * pointer, words and keys come back out, from that frame only. The editing
 * layer is drawn over it.
 */
export function DesignerCanvas({
  page,
  postPath = null,
  visitor = 'in',
  sample = null,
  size,
  theme,
  locale,
  sort,
  refreshKey = '',
  design,
  structural,
  zoom = 'fit',
  name,
  trying = false,
  onSelect,
  onFollow,
  onHover,
  onMenu,
  onMenuHover,
  onContext,
  onWords,
  onKey,
  onEscape,
  onLoad,
  onLocation,
  layer,
  skeleton,
  untilDrawn = false,
  inPlace = false,
  draft = false,
  still = false,
}: {
  page: DesignerPage
  /** The item the page shows, such as the post on the post page. */
  postPath?: string | null
  /** Who the page is drawn for. */
  visitor?: CanvasVisitor
  /** The page drawn from sample content instead. */
  sample?: SamplePage | null
  size: CanvasSize
  theme: 'light' | 'dark'
  locale: string
  sort: 'trending' | 'top' | 'new'
  /**
   * A new key loads the page afresh. The builder's own canvas keeps its page
   * when a publish lands: it already draws the design just published.
   */
  refreshKey?: string
  design: PortalPreviewProps['design']
  structural: PortalPreviewDraft
  /** Scaled to fit the room, or at a set scale that scrolls, so zooming the browser can enlarge it. */
  zoom?: CanvasZoom
  /** What the frame is named, after the page it shows; such as "Live now" in a review. */
  name?: string
  /** Preview: clicks act as a visitor's, links open within the frame, nothing is picked. */
  trying?: boolean
  /** A click: the block under it, or null for empty canvas, and the portal path of a link there. */
  /** The element under the click, in the frame's page, names what in the block is picked. */
  onSelect: (section: string | null, link: string | null, target?: Element | null) => void
  /** A click with Ctrl or Cmd held on a link of the portal, to go where it goes. */
  onFollow?: (link: string) => void
  /** The block the pointer is over, or null, and the element under it. */
  onHover?: (section: string | null, target?: Element | null) => void
  /** A click or a double-click on a menu item, the logo or sign in, in place of picking. */
  onMenu?: (menu: MenuTarget, how: 'click' | 'rename', target?: Element | null) => void
  /** The menu item the pointer is over, or null. */
  onMenuHover?: (menu: MenuTarget | null) => void
  /**
   * A right-click on the page, not on the menu: the block under it and the
   * element there, as a click names them, and where it was in the builder's
   * window, to open the actions there.
   */
  onContext?: (section: string | null, target: Element | null, at: { x: number; y: number }) => void
  onWords: (field: string, value: WordsDoc | string) => void
  onKey: (key: 'undo' | 'redo') => void
  /** An Escape the page did not take: to leave Preview, or to let go of what is picked. */
  onEscape?: () => void
  /** The frame loaded a page, afresh or after following a link. */
  onLoad?: () => void
  /** Where the page went, in Preview. */
  onLocation?: (path: string) => void
  /** The editing layer, drawn over the frame. */
  layer?: (canvas: CanvasFrame) => ReactNode
  /** Shapes of the page's parts, drawn until the frame says its page is ready. */
  skeleton?: ReactNode
  /** Keeps the skeleton until the frame says it drew the design given, not the published one. */
  untilDrawn?: boolean
  /**
   * Goes to another page or item inside the page the frame holds, rather than
   * loading the frame afresh, so its code and the draft drawn in it stay warm.
   */
  inPlace?: boolean
  /**
   * Loads the page drawn by the server with the saved draft, so it shows the
   * draft from its first paint: the publish review's After frame.
   */
  draft?: boolean
  /** A picture, not a page to use: the page inside shows no scrollbar. */
  still?: boolean
}) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  // The frame element itself, for the layer: a new one each time the page loads afresh.
  const [frame, setFrame] = useState<HTMLIFrameElement | null>(null)
  const frameRef = useCallback((element: HTMLIFrameElement | null) => {
    iframeRef.current = element
    setFrame(element)
  }, [])
  const box = useRef<HTMLDivElement>(null)
  const [room, setRoom] = useState({ width: 0, height: 0 })
  // Measured before the first paint, so the frame starts at the room's size rather than growing into it.
  useLayoutEffect(() => {
    const element = box.current
    if (!element) return
    const { width, height } = element.getBoundingClientRect()
    if (width) setRoom({ width, height })
    const observer = new ResizeObserver(([entry]) =>
      setRoom((before) =>
        before.width === entry.contentRect.width && before.height === entry.contentRect.height
          ? before
          : { width: entry.contentRect.width, height: entry.contentRect.height }
      )
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const told = useRef(trying)
  told.current = trying
  const shownTheme = useRef(theme)
  shownTheme.current = theme
  const tellDesigner = useCallback((target: Window | null | undefined) => {
    target?.postMessage(
      { type: 'quackback:preview-designer', trying: told.current },
      window.location.origin
    )
    target?.postMessage({ type: PREVIEW_THEME, theme: shownTheme.current }, window.location.origin)
  }, [])
  usePreviewPosting(iframeRef, {
    draftCss: '',
    cssDirty: false,
    draft: structural,
    draftDirty: true,
    design,
    onReady: tellDesigner,
    // The page says when it drew each design, so it follows a change on the next frame.
    paced: true,
  })
  useEffect(() => tellDesigner(iframeRef.current?.contentWindow), [trying, tellDesigner])
  // Light or dark changes in place: the page keeps its scroll and what it drew.
  useEffect(() => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: PREVIEW_THEME, theme },
      window.location.origin
    )
  }, [theme])

  // The frame that said its page is ready, by its key: a new page loads, and is not, until it says so.
  const [readyKey, setReadyKey] = useState<string | null>(null)
  // The frame that drew the design it was given, by its key.
  const [drawnKey, setDrawnKey] = useState<string | null>(null)
  const frameKey = useRef('')
  const handlers = useRef({
    onSelect,
    onFollow,
    onHover,
    onMenu,
    onMenuHover,
    onContext,
    onWords,
    onKey,
    onEscape,
    onLocation,
    onLoad,
    trying,
  })
  handlers.current = {
    onSelect,
    onFollow,
    onHover,
    onMenu,
    onMenuHover,
    onContext,
    onWords,
    onKey,
    onEscape,
    onLocation,
    onLoad,
    trying,
  }
  /** Tells the frame's page to go to `src` in place: the frame and its page's code stay warm. */
  const navigateFrame = useCallback((src: string) => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: PREVIEW_NAVIGATE, href: src },
      window.location.origin
    )
  }, [])

  // What the frame's document loaded with, by its key, and what it was last asked to show.
  const docKey = useRef('')
  const shown = useRef({ doc: '', key: '', src: '' })
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (
        event.origin !== window.location.origin ||
        event.source !== iframeRef.current?.contentWindow
      )
        return
      const message = event.data as Record<string, unknown> | null
      if (message?.type === 'quackback:preview-ready') {
        // A page that went elsewhere since its document loaded is sent there; it is ready once there.
        if (shown.current.key !== docKey.current) navigateFrame(shown.current.src)
        else setReadyKey(frameKey.current)
      }
      if (message?.type === 'quackback:preview-navigated' && message.href === shown.current.src) {
        setReadyKey(frameKey.current)
        setDrawnKey(frameKey.current)
        handlers.current.onLoad?.()
      }
      if (message?.type === 'quackback:preview-drawn') setDrawnKey(frameKey.current)
      const menu = isMenuTarget(message?.menu) ? message.menu : null
      // The element at the point the frame names, read from its own page.
      const target =
        typeof message?.x === 'number' && typeof message?.y === 'number'
          ? (iframeRef.current?.contentDocument?.elementFromPoint(message.x, message.y) ?? null)
          : null
      if (message?.type === 'quackback:preview-section') {
        const section = typeof message.section === 'string' ? message.section : null
        const link = framePath(message.link)
        if (message.follow === true && link && handlers.current.onFollow)
          handlers.current.onFollow(link)
        else if (menu && handlers.current.onMenu) handlers.current.onMenu(menu, 'click', target)
        else handlers.current.onSelect(section, link, target)
      } else if (message?.type === 'quackback:preview-pointer') {
        handlers.current.onHover?.(
          typeof message.section === 'string' ? message.section : null,
          target
        )
        handlers.current.onMenuHover?.(menu)
      } else if (message?.type === 'quackback:preview-context') {
        const section = typeof message.section === 'string' ? message.section : null
        // A menu item's actions are its click menu.
        if (menu && handlers.current.onMenu) handlers.current.onMenu(menu, 'click', target)
        else if (
          handlers.current.onContext &&
          typeof message.x === 'number' &&
          typeof message.y === 'number'
        ) {
          const frame = iframeRef.current!
          const box = frame.getBoundingClientRect()
          const scale = frame.offsetWidth ? box.width / frame.offsetWidth : 1
          handlers.current.onContext(section, target, {
            x: box.left + message.x * scale,
            y: box.top + message.y * scale,
          })
        }
      } else if (message?.type === 'quackback:preview-rename') {
        if (menu) handlers.current.onMenu?.(menu, 'rename')
      } else if (message?.type === 'quackback:preview-words') {
        const words = framedWords(message)
        if (words) handlers.current.onWords(words.field, words.value)
      } else if (
        message?.type === 'quackback:preview-key' &&
        (message.key === 'undo' || message.key === 'redo')
      )
        handlers.current.onKey(message.key)
      else if (message?.type === 'quackback:preview-key' && message.key === 'escape')
        handlers.current.onEscape?.()
      else if (
        (message?.type === 'quackback:preview-location' ||
          message?.type === 'quackback:preview-ready') &&
        handlers.current.trying
      ) {
        const path = framePath(message.path)
        if (path) handlers.current.onLocation?.(path)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  const width = CANVAS_WIDTHS[size]
  const phoneMode = size === 'phone' && !trying
  const { scale, height, outer, room: drawn } = frameBox(room, width, zoom)
  const src = canvasSrc({ page, theme, locale, sort, postPath, visitor, sample, draft })
  // What the frame shows, by its address in light: its page is ready once it says so.
  const key = `${canvasSrc({ page, theme: 'light', locale, sort, postPath, visitor, sample, draft })}:${refreshKey}:${trying}`
  // The document it shows that in. In place, another language or visitor, a sample, Preview or
  // a new refresh key loads the frame afresh, and another page or item is gone to in the page
  // itself; else every page loads afresh. Light or dark is sent to the page, which keeps the
  // address it loaded with.
  const doc = inPlace
    ? `${frameDocument({ page, locale, sort, postPath, visitor, sample, trying })}:${refreshKey}`
    : key
  const [loaded, setLoaded] = useState({ doc, key, src })
  if (loaded.doc !== doc) setLoaded({ doc, key, src })
  const frameSrc = loaded.doc === doc ? loaded.src : src
  frameKey.current = key
  docKey.current = loaded.doc === doc ? loaded.key : key
  // Another page in the same document: the frame is told to go there.
  useEffect(() => {
    // Light or dark alone is no other page: the frame is told that in place, as it is.
    if (shown.current.doc !== doc) {
      shown.current = { doc, key, src }
      return
    }
    if (shown.current.key === key) return
    shown.current = { doc, key, src }
    navigateFrame(src)
    // Only another page navigates; the address it goes to is in the theme shown then.
  }, [doc, key, navigateFrame])
  const ready = readyKey === key && (!untilDrawn || drawnKey === key)
  // A page that never says it is ready (an error, say) is shown once it has loaded a while.
  const [loadedKey, setLoadedKey] = useState<string | null>(null)
  useEffect(() => {
    if (loadedKey !== key || ready) return
    const timer = setTimeout(() => {
      setReadyKey(key)
      setDrawnKey(key)
    }, LOADED_GRACE_MS)
    return () => clearTimeout(timer)
  }, [loadedKey, key, ready])
  return (
    <div
      ref={box}
      data-canvas-box=""
      aria-busy={skeleton ? !ready : undefined}
      className={`relative h-full min-h-0 w-full flex-1 ${zoom === 'fit' ? 'overflow-hidden' : 'overflow-auto'}`}
    >
      <div
        // On a phone a change is a phone value, so the frame is tinted; a preview edits nothing.
        data-phone-mode={phoneMode || undefined}
        className={cn(
          'relative mx-auto overflow-hidden rounded-lg border bg-background shadow-sm',
          phoneMode ? PHONE_TINT.frame : 'border-border'
        )}
        style={outer}
      >
        <iframe
          // Leaving Preview loads the page afresh, back where the builder is.
          key={doc}
          ref={frameRef}
          onLoad={(event) => {
            setLoadedKey(key)
            // The server drew this page with the draft: it is ready as it is, with nothing
            // to wait for. (A page gone to in place since says so when it gets there.)
            const root = event.currentTarget.contentDocument?.documentElement
            if (untilDrawn && docKey.current === key && root?.hasAttribute(DRAFT_DRAWN_ATTRIBUTE)) {
              setReadyKey(key)
              setDrawnKey(key)
            }
            onLoad?.()
          }}
          src={frameSrc}
          title={[
            name,
            PAGE_NAMES[page],
            sample && 'sample content',
            size,
            theme,
            trying && 'preview, links work',
          ]
            .filter(Boolean)
            .join(', ')}
          // The page's own links and fields are not stops on the way to the settings;
          // its parts are reached from the outline. In Preview, they are the page.
          tabIndex={trying ? 0 : -1}
          // A picture's page shows no scrollbar of its own.
          scrolling={still ? 'no' : undefined}
          // The designer's own canvas, which its checks measure; not a review's frames.
          data-designer-canvas={name ? undefined : ''}
          className="border-0 bg-background"
          style={{
            width,
            height,
            transform: scale < 1 ? `scale(${scale})` : undefined,
            transformOrigin: 'top left',
          }}
        />
        {skeleton && (
          // The whole frame, in the page's light or dark, until the page is ready; then it fades.
          <div
            data-canvas-cover=""
            className={cn(
              'pointer-events-none absolute top-0 left-0 overflow-hidden bg-background transition-[opacity,visibility] duration-150 ease-out motion-reduce:transition-none',
              theme === 'dark' && 'dark',
              ready && 'invisible opacity-0'
            )}
            style={{
              width,
              height,
              transform: scale < 1 ? `scale(${scale})` : undefined,
              transformOrigin: 'top left',
            }}
          >
            {skeleton}
          </div>
        )}
        {layer?.({ frame, scale, room: drawn })}
      </div>
    </div>
  )
}
