import { nameInitial } from '@/lib/shared/utils/initial'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/shared/utils'
import type { PortalPreviewDraft } from '@/components/public/preview-draft-context'
import type { PortalDesign } from '@/lib/shared/design/schema'

interface PortalPreviewProps {
  /** Forced preview theme — forwarded to the portal iframe as `?theme=`. */
  theme: 'light' | 'dark'
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
  /** Structural drafts (nav, welcome card, header identity), injected live. */
  draft: PortalPreviewDraft
  /** Whether the navigation or welcome card holds an unsaved edit. */
  draftDirty: boolean
  /** Constrain the frame to a phone-ish width. */
  viewport: 'desktop' | 'mobile'
  /** Shown in the fake browser chrome. */
  workspaceName: string
  /** Browser-tab icon slot — the workspace logo (the portal's favicon). */
  faviconUrl?: string | null
  /**
   * Lay the desktop preview out at desktop width and scale it to fit, so
   * desktop layouts (an inline header, the filter panel) show as visitors see them.
   */
  scaleToDesktop?: boolean
  /** The feed's sort in the frame; a design's default sort, which changes by reloading it. */
  sort?: 'trending' | 'top' | 'new'
  /** A draft portal design, resolved: applied in the frame in place of the saved one. */
  design?: {
    css: string
    attributes: Record<string, string>
    fontIds: string[]
    headline: { title: Record<string, string>; subtitle: Record<string, string> } | null
    home?: PortalDesign['pages']['home']
    nav?: PortalDesign['nav']
  } | null
  /** The page the frame shows: the root, Home or the feed at its own address. */
  page?: PreviewPage
}

export type PreviewPage = 'root' | 'home' | 'feedback'

/** The width a desktop visitor's browser lays the portal out at. */
const DESKTOP_WIDTH = 1280

/**
 * The framed portal home, spelled the way the portal canonicalizes it (the
 * preview flag as a boolean, the default sort included) so the frame loads
 * without a redirect first.
 */
export function portalPreviewSrc(
  theme: 'light' | 'dark',
  sort: 'trending' | 'top' | 'new' = 'trending',
  page: PreviewPage = 'root'
) {
  if (page === 'home') return `/?theme=${theme}&preview=true&page=home`
  return `${page === 'feedback' ? '/feedback' : '/'}?theme=${theme}&preview=true&sort=${sort}`
}

/**
 * Live preview of the public portal: the real `/` portal app in a same-origin
 * iframe, wrapped in simulated browser chrome (which is also where the
 * favicon setting becomes visible). Saved config renders natively; unsaved
 * drafts are postMessaged into the frame and applied by
 * PortalPreviewProvider on the portal side.
 */
export function PortalPreview({
  theme,
  refreshKey,
  draftCss,
  cssDirty,
  draft,
  draftDirty,
  viewport,
  workspaceName,
  faviconUrl,
  design = null,
  scaleToDesktop = false,
  sort = 'trending',
  page = 'root',
}: PortalPreviewProps) {
  const frameBox = useRef<HTMLDivElement>(null)
  const [boxWidth, setBoxWidth] = useState(0)
  useEffect(() => {
    const box = frameBox.current
    if (!box || !scaleToDesktop) return
    const observer = new ResizeObserver(([entry]) => setBoxWidth(entry.contentRect.width))
    observer.observe(box)
    return () => observer.disconnect()
  }, [scaleToDesktop])
  const frameHeight = viewport === 'mobile' ? 640 : 720
  const scale =
    scaleToDesktop && viewport === 'desktop' && boxWidth > 0
      ? Math.min(1, boxWidth / DESKTOP_WIDTH)
      : 1
  const iframeRef = useRef<HTMLIFrameElement>(null)
  // What the current frame document holds on each channel: no stylesheet and
  // no structural draft while it shows the saved config. Every message
  // re-renders the portal page inside the frame, so a channel's draft goes in
  // only while it holds an unsaved edit, and only when it changes. A discard
  // puts the saved values back: an empty stylesheet, the saved structure.
  const frameCss = useRef('')
  const frameDraft = useRef<PortalPreviewDraft | null>(null)
  const frameDesign = useRef<PortalPreviewProps['design']>(null)

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
    if (design !== frameDesign.current) {
      target.postMessage({ type: 'quackback:preview-design', design }, origin)
      frameDesign.current = design
    }
  }, [draftCss, cssDirty, draft, draftDirty, design])

  // Debounced push on draft changes (typing in the CSS editor / title field).
  useEffect(() => {
    const timer = window.setTimeout(postDrafts, 150)
    return () => window.clearTimeout(timer)
  }, [postDrafts])

  // The portal announces readiness from each document the frame loads (a
  // save-triggered reload, a theme switch); that document starts from the
  // saved config, so re-send any unsaved edits to keep them on screen.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return
      if ((event.data as { type?: string } | null)?.type === 'quackback:preview-ready') {
        frameCss.current = ''
        frameDraft.current = null
        frameDesign.current = null
        postDrafts()
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [postDrafts])

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-border bg-card transition-[max-width] duration-300',
        viewport === 'mobile' ? 'max-w-[404px] mx-auto' : 'max-w-none'
      )}
    >
      {/* Simulated browser chrome */}
      <div className="flex items-center gap-2.5 border-b border-border bg-muted/50 px-3 py-2">
        <div className="flex gap-1.5" aria-hidden="true">
          <span className="size-2.5 rounded-full bg-muted-foreground/20" />
          <span className="size-2.5 rounded-full bg-muted-foreground/20" />
          <span className="size-2.5 rounded-full bg-muted-foreground/20" />
        </div>
        <div className="flex min-w-0 items-center gap-1.5 rounded-full border border-border bg-background px-2.5 py-1">
          {faviconUrl ? (
            <img src={faviconUrl} alt="" className="size-3.5 rounded-sm" />
          ) : (
            <span className="flex size-3.5 items-center justify-center rounded-sm bg-primary text-[11px] leading-none font-bold text-primary-foreground">
              {nameInitial(workspaceName) || 'P'}
            </span>
          )}
          <span className="truncate text-xs text-muted-foreground">
            {typeof window !== 'undefined' ? window.location.host : ''}
          </span>
        </div>
      </div>

      <div ref={frameBox} className="overflow-hidden" style={{ height: frameHeight }}>
        <iframe
          key={refreshKey}
          ref={iframeRef}
          src={portalPreviewSrc(theme, sort, page)}
          title="Portal preview"
          className="w-full border-0 bg-background"
          style={
            scale < 1
              ? {
                  width: DESKTOP_WIDTH,
                  height: frameHeight / scale,
                  transform: `scale(${scale})`,
                  transformOrigin: 'top left',
                }
              : { height: frameHeight }
          }
        />
      </div>
    </div>
  )
}
