import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/shared/utils'
import type {
  PortalPreviewDraft,
  PreviewEditLabels,
  PreviewEditTarget,
} from '@/components/public/preview-draft-context'

export type PreviewDevice = 'desktop' | 'tablet' | 'mobile'

/** Each device's page width. Every frame has the same thin edge, no device bezel. */
export const PREVIEW_DEVICES: Record<PreviewDevice, { width: number }> = {
  desktop: { width: 1280 },
  tablet: { width: 820 },
  mobile: { width: 390 },
}

/** Tallest a phone or tablet frame gets; a desktop frame fills the canvas. */
const DEVICE_HEIGHT: Record<PreviewDevice, number | null> = {
  desktop: null,
  tablet: 1180,
  mobile: 844,
}

/** Space kept around the frame inside the canvas. */
const CANVAS_GUTTER: Record<PreviewDevice, number> = { desktop: 32, tablet: 32, mobile: 32 }

export interface PreviewFit {
  /** The page width the frame renders at. */
  width: number
  /** How much it is scaled down to fit, 1 when it fits as is. */
  scale: number
}

interface PortalPreviewProps {
  /** Forced preview theme — forwarded to the portal iframe as `?theme=`. */
  theme: 'light' | 'dark'
  /**
   * The page to show. The frame follows its own links; it loads this address
   * only when it differs from where the frame already is, so a parent that
   * follows `onLocation` never reloads it.
   */
  path: string
  /**
   * Remount signal: derive from the persisted config so the embedded portal
   * reloads when a save lands — and only then. The portal loader does real
   * work per load (access + session + locale); draft edits must never reload
   * it, they travel over postMessage instead.
   */
  refreshKey: string
  /** The theme editor's full draft stylesheet, injected live into the iframe. */
  draftCss: string
  /** Whether the theme holds an unsaved edit (the saved theme renders natively otherwise). */
  cssDirty: boolean
  /** Structural drafts (nav, welcome card, Help Center home, logo, button shape), injected live. */
  draft: PortalPreviewDraft
  /** Whether any structural draft holds an unsaved edit. */
  draftDirty: boolean
  /** The page width to render, scaled to fit the space given. */
  device: PreviewDevice
  /** Turns on edit mode in the frame: these parts become clickable, with these names. */
  editLabels?: PreviewEditLabels
  /** The page the frame shows now, after every navigation inside it. */
  onLocation?: (path: string) => void
  /** A part of the page clicked in edit mode. */
  onPick?: (target: PreviewEditTarget) => void
  /** The page width and scale, whenever either changes. */
  onFit?: (fit: PreviewFit) => void
  /**
   * Changes when the draft was replaced in one step that is not typing (an
   * import): that draft goes to the frame at once, without the typing pause.
   */
  flushKey?: unknown
  /**
   * Parts of the page to outline for a moment, after a change that is not
   * typing (a chat request, an import). A new object outlines again. The
   * draft it came with goes to the frame first, so the outlines land on the
   * new look.
   */
  flash?: { targets: PreviewEditTarget[] } | null
  /**
   * Chrome drawn over the frame itself, at any device or scale. It never takes
   * a click. The frame's scale is on `--preview-scale`, for a part that keeps
   * its own size.
   */
  overlay?: ReactNode
  className?: string
}

/**
 * A portal page at the exact address the portal routes canonicalize its search
 * to (the preview flag as a boolean, the home page's default sort included),
 * so the frame loads without a redirect first.
 */
export function portalPreviewSrc(theme: 'light' | 'dark', path: string) {
  if (path === '/') return `/?theme=${theme}&preview=true&sort=trending`
  return `${path}?theme=${theme}&preview=true`
}

/**
 * Live preview of the public portal: the real portal app in a same-origin
 * iframe, at a device's width, scaled to fit the space it is given. Saved
 * config renders natively; unsaved drafts are postMessaged into the frame and
 * applied by PortalPreviewProvider on the portal side. Messages go to the
 * frame's own window, and only the frame's own window is listened to.
 */
export function PortalPreview({
  theme,
  path,
  refreshKey,
  draftCss,
  cssDirty,
  draft,
  draftDirty,
  device,
  editLabels,
  onLocation,
  onPick,
  onFit,
  flushKey,
  flash,
  overlay,
  className,
}: PortalPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  // What the current frame document holds on each channel: no stylesheet and
  // no structural draft while it shows the saved config. Every message
  // re-renders the portal page inside the frame, so a channel's draft goes in
  // only while it holds an unsaved edit, and only when it changes. A discard
  // puts the saved values back: an empty stylesheet, the saved structure.
  const frameCss = useRef('')
  const frameDraft = useRef<PortalPreviewDraft | null>(null)

  // The page the frame was told to load, and where it is now. A remount (a
  // theme switch, a publish) reloads the page the frame is on.
  const [srcPath, setSrcPath] = useState(path)
  const framePath = useRef(path)
  useEffect(() => {
    if (path !== framePath.current) {
      framePath.current = path
      setSrcPath(path)
    }
  }, [path])
  const remountKey = `${refreshKey}:${theme}`
  const lastRemount = useRef(remountKey)
  useEffect(() => {
    if (remountKey !== lastRemount.current) {
      lastRemount.current = remountKey
      setSrcPath(framePath.current)
    }
  }, [remountKey])

  const postDrafts = useCallback(() => {
    const target = iframeRef.current?.contentWindow
    if (!target) return
    const origin = window.location.origin
    const css = cssDirty ? draftCss : ''
    if (css !== frameCss.current) {
      target.postMessage({ type: 'quackback:preview-css', css }, origin)
      frameCss.current = css
    }
    if ((draftDirty || frameDraft.current) && draft !== frameDraft.current) {
      target.postMessage({ type: 'quackback:preview-draft', draft }, origin)
      frameDraft.current = draft
    }
  }, [draftCss, cssDirty, draft, draftDirty])

  const postEditMode = useCallback(() => {
    if (!editLabels) return
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'quackback:preview-edit-mode', enabled: true, labels: editLabels },
      window.location.origin
    )
  }, [editLabels])

  // Debounced push on draft changes (typing in the CSS editor / title field).
  // A new flush key sends the draft that came with it straight away.
  const flushed = useRef(flushKey)
  useEffect(() => {
    if (flushKey !== flushed.current) {
      flushed.current = flushKey
      postDrafts()
      return
    }
    const timer = window.setTimeout(postDrafts, 150)
    return () => window.clearTimeout(timer)
  }, [postDrafts, flushKey])

  const flashed = useRef(flash)
  useEffect(() => {
    if (flash === flashed.current) return
    flashed.current = flash
    if (!flash || flash.targets.length === 0) return
    postDrafts()
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'quackback:preview-flash', targets: flash.targets },
      window.location.origin
    )
  }, [flash, postDrafts])

  // The portal announces readiness from each document the frame loads (a
  // save-triggered reload, a theme switch); that document starts from the
  // saved config, so re-send edit mode and any unsaved edits to keep them on
  // screen. It also reports each page it shows, and parts clicked in edit mode.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return
      if (!event.source || event.source !== iframeRef.current?.contentWindow) return
      const msg = event.data as { type?: string; path?: unknown; target?: unknown } | null
      if (msg?.type === 'quackback:preview-ready') {
        frameCss.current = ''
        frameDraft.current = null
        postEditMode()
        postDrafts()
      } else if (msg?.type === 'quackback:preview-location' && typeof msg.path === 'string') {
        framePath.current = msg.path
        onLocation?.(msg.path)
      } else if (msg?.type === 'quackback:preview-pick' && typeof msg.target === 'string') {
        onPick?.(msg.target as PreviewEditTarget)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [postDrafts, postEditMode, onLocation, onPick])

  const fit = useFit(containerRef, device)
  useEffect(() => {
    onFit?.({ width: PREVIEW_DEVICES[device].width, scale: fit.scale })
  }, [onFit, device, fit.scale])

  // The page fades while the frame changes size, then settles.
  const [switching, setSwitching] = useState(false)
  const lastDevice = useRef(device)
  useEffect(() => {
    if (device === lastDevice.current) return
    lastDevice.current = device
    setSwitching(true)
    const timer = window.setTimeout(() => setSwitching(false), 420)
    return () => window.clearTimeout(timer)
  }, [device])

  const { width } = PREVIEW_DEVICES[device]

  return (
    <div
      ref={containerRef}
      className={cn('relative flex min-h-0 justify-center overflow-hidden', className)}
    >
      <div
        className="relative shrink-0 origin-top overflow-hidden rounded-lg border border-border bg-background shadow-sm transition-[width,height,transform] duration-[420ms] ease-[cubic-bezier(.2,.8,.2,1)] motion-reduce:transition-none"
        style={
          {
            width,
            height: fit.height,
            transform: fit.scale === 1 ? undefined : `scale(${fit.scale})`,
            marginTop: CANVAS_GUTTER[device] / 2,
            '--preview-scale': fit.scale,
          } as CSSProperties
        }
      >
        <iframe
          ref={iframeRef}
          key={remountKey}
          src={portalPreviewSrc(theme, srcPath)}
          title="Portal preview"
          className={cn(
            'block h-full w-full border-0 bg-background transition-opacity duration-200 motion-reduce:transition-none',
            switching && 'opacity-35'
          )}
        />
        {overlay ? (
          <div className="pointer-events-none absolute inset-0 rounded-[inherit]">{overlay}</div>
        ) : null}
      </div>
    </div>
  )
}

/** The scale and (unscaled) height that fit a device's frame in its container. */
function useFit(
  containerRef: React.RefObject<HTMLDivElement | null>,
  device: PreviewDevice
): { scale: number; height: number } {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)

  useLayoutEffect(() => {
    const element = containerRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight })
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [containerRef])

  const { width } = PREVIEW_DEVICES[device]
  if (!size || size.width === 0 || size.height === 0) return { scale: 1, height: 720 }
  const gutter = CANVAS_GUTTER[device]
  const scale = Math.min(1, (size.width - gutter) / width)
  const available = (size.height - gutter) / scale
  const cap = DEVICE_HEIGHT[device]
  return { scale, height: Math.max(320, cap ? Math.min(available, cap) : available) }
}
