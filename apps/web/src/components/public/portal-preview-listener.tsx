import { useEffect, useState, type ReactNode } from 'react'
import { PreviewDraftProvider, type PortalPreviewDraft } from './preview-draft-context'

/**
 * Bridge between the admin Branding page and the portal preview iframe.
 *
 * Mounted from the portal layout ONLY when the document is loaded with
 * `?preview=1` inside a same-origin iframe (the admin live preview). It
 * listens for postMessage from the parent and exposes two draft channels:
 *
 * - `quackback:preview-css`: the theme editor's full draft stylesheet,
 *   rendered into a <style> AFTER the children so it cascades over the
 *   loader-injected theme styles and custom CSS.
 * - `quackback:preview-draft`: structural drafts (nav config, welcome card,
 *   header identity) provided via PreviewDraftContext for draft-aware
 *   components (PortalHeader, the welcome card render site).
 *
 * CSS is applied via a text node (never innerHTML) and both sides verify
 * the message origin, so a hostile page cannot inject anything executable.
 */
export function PortalPreviewProvider({
  enabled,
  children,
}: {
  enabled: boolean
  children: ReactNode
}) {
  const [css, setCss] = useState('')
  const [draft, setDraft] = useState<PortalPreviewDraft | null>(null)

  // Only a framed, explicitly preview-flagged document listens.
  const active = enabled && typeof window !== 'undefined' && window.self !== window.top

  useEffect(() => {
    if (!active) return
    function onMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return
      const msg = event.data as { type?: string; css?: unknown; draft?: unknown } | null | undefined
      if (msg?.type === 'quackback:preview-css' && typeof msg.css === 'string') {
        setCss(msg.css)
      } else if (msg?.type === 'quackback:preview-draft' && msg.draft) {
        setDraft(msg.draft as PortalPreviewDraft)
      }
    }
    window.addEventListener('message', onMessage)
    // Tell the parent we're ready so it re-sends current drafts after a remount.
    window.parent.postMessage({ type: 'quackback:preview-ready' }, window.location.origin)
    return () => window.removeEventListener('message', onMessage)
  }, [active])

  if (!enabled) return <>{children}</>

  // Merge the raw draft css into the same context payload draft-aware
  // components already read (see PortalPreviewDraft.css) — one channel for
  // the branding page's live edits instead of a second context.
  const draftWithCss: PortalPreviewDraft | null = draft || css ? { ...draft, css } : null

  return (
    <PreviewDraftProvider value={draftWithCss}>
      {children}
      {css ? <style data-preview-override="">{css}</style> : null}
    </PreviewDraftProvider>
  )
}
