import { useCallback, useEffect, useRef } from 'react'
import { cn } from '@/lib/shared/utils'
import type { PortalPreviewDraft } from '@/components/public/preview-draft-context'

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
  /** Structural drafts (nav, welcome card, header identity), injected live. */
  draft: PortalPreviewDraft
  /** Constrain the frame to a phone-ish width. */
  viewport: 'desktop' | 'mobile'
  /** Shown in the fake browser chrome. */
  workspaceName: string
  /** Browser-tab icon slot — the workspace logo (the portal's favicon). */
  faviconUrl?: string | null
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
  draft,
  viewport,
  workspaceName,
  faviconUrl,
}: PortalPreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null)

  const postDrafts = useCallback(() => {
    const target = iframeRef.current?.contentWindow
    if (!target) return
    const origin = window.location.origin
    target.postMessage({ type: 'quackback:preview-css', css: draftCss }, origin)
    target.postMessage({ type: 'quackback:preview-draft', draft }, origin)
  }, [draftCss, draft])

  // Debounced push on draft changes (typing in the CSS editor / title field).
  useEffect(() => {
    const timer = window.setTimeout(postDrafts, 150)
    return () => window.clearTimeout(timer)
  }, [postDrafts])

  // The iframe announces readiness after every (re)mount; re-send the current
  // drafts so a save-triggered reload doesn't lose unsaved edits on screen.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return
      if ((event.data as { type?: string } | null)?.type === 'quackback:preview-ready') {
        postDrafts()
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [postDrafts])

  return (
    <div
      className={cn(
        'overflow-hidden rounded-xl border border-border bg-card shadow-sm transition-[max-width] duration-300',
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
              {workspaceName.charAt(0).toUpperCase() || 'P'}
            </span>
          )}
          <span className="truncate text-xs text-muted-foreground">
            {typeof window !== 'undefined' ? window.location.host : ''}
          </span>
        </div>
      </div>

      <iframe
        key={refreshKey}
        ref={iframeRef}
        src={`/?theme=${theme}&preview=1`}
        title="Portal preview"
        onLoad={postDrafts}
        className={cn(
          'w-full border-0 bg-background',
          viewport === 'mobile' ? 'h-[640px]' : 'h-[720px]'
        )}
      />
    </div>
  )
}
