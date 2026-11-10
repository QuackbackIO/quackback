import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { PortalPreviewDraft } from '@/components/public/preview-draft-context'
import type { PortalPreviewProps } from './portal-preview'

/**
 * Posts unsaved drafts into a portal preview frame. What the frame document
 * holds on each channel is tracked: no stylesheet and no structural draft
 * while it shows the saved config. Every message re-renders the portal page
 * inside the frame, so a channel's draft goes in only while it holds an
 * unsaved edit, and only when it changes. A discard puts the saved values
 * back: an empty stylesheet, the saved structure. `onReady` runs each time
 * the frame loads a document, after the drafts are sent again.
 */
export function usePreviewPosting(
  iframeRef: RefObject<HTMLIFrameElement | null>,
  {
    draftCss,
    cssDirty,
    draft,
    draftDirty,
    design,
    onReady,
  }: {
    draftCss: string
    cssDirty: boolean
    draft: PortalPreviewDraft
    draftDirty: boolean
    design: PortalPreviewProps['design']
    onReady?: (frame: Window) => void
  }
): void {
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
  }, [iframeRef, draftCss, cssDirty, draft, draftDirty, design])

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
      const frame = iframeRef.current?.contentWindow
      if (event.origin !== window.location.origin || !frame || event.source !== frame) return
      if ((event.data as { type?: string } | null)?.type === 'quackback:preview-ready') {
        frameCss.current = ''
        frameDraft.current = null
        frameDesign.current = null
        postDrafts()
        onReady?.(frame)
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [iframeRef, postDrafts, onReady])
}
