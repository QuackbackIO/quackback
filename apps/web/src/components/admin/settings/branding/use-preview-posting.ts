import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { PortalPreviewDraft } from '@/components/public/preview-draft-context'
import type { PortalPreviewProps } from './portal-preview'

/**
 * How long a paced design waits for the frame to say it drew the one before,
 * before it goes anyway: a frame that never says so is still kept up to date.
 */
export const DRAWN_WAIT_MS = 500

/**
 * Posts unsaved drafts into a portal preview frame. What the frame document
 * holds on each channel is tracked: no stylesheet and no structural draft
 * while it shows the saved config. Every message re-renders the portal page
 * inside the frame, so a channel's draft goes in only while it holds an
 * unsaved edit, and only when it changes. A design equal to the one the frame
 * holds, such as the same draft read back after a publish, is not sent again.
 * A discard puts the saved values back: an empty stylesheet, the saved
 * structure. `onReady` runs each time the frame loads a document, after the
 * drafts are sent again.
 *
 * Paced, for a frame that says when it drew a design (`quackback:preview-drawn`,
 * as the portal's does), the design goes in on the next animation frame
 * rather than after a pause, so the frame follows a drag or typing as it
 * happens; while the frame is still drawing one design, only the latest of
 * those made meanwhile follows it, so the frame never falls behind.
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
    paced = false,
  }: {
    draftCss: string
    cssDirty: boolean
    draft: PortalPreviewDraft
    draftDirty: boolean
    design: PortalPreviewProps['design']
    onReady?: (frame: Window) => void
    paced?: boolean
  }
): void {
  const frameCss = useRef('')
  const frameDraft = useRef<PortalPreviewDraft | null>(null)
  const frameDesign = useRef<PortalPreviewProps['design']>(null)
  // The design the frame holds, as text, to tell an equal design from a change.
  const frameDesignText = useRef('null')
  // Paced: the wait for the frame to say it drew the design sent last, while it lasts.
  const drawing = useRef<ReturnType<typeof setTimeout> | null>(null)
  const latestDesign = useRef(design)
  latestDesign.current = design

  const postDesign = useCallback(() => {
    const target = iframeRef.current?.contentWindow
    const next = latestDesign.current
    if (!target || next === frameDesign.current || drawing.current) return
    frameDesign.current = next
    const text = JSON.stringify(next ?? null)
    if (text === frameDesignText.current) return
    frameDesignText.current = text
    target.postMessage({ type: 'quackback:preview-design', design: next }, window.location.origin)
    if (!paced) return
    drawing.current = setTimeout(() => {
      drawing.current = null
      postDesign()
    }, DRAWN_WAIT_MS)
  }, [iframeRef, paced])

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
    if (!paced) postDesign()
  }, [iframeRef, draftCss, cssDirty, draft, draftDirty, paced, postDesign])

  // Debounced push on draft changes (typing in the CSS editor / title field).
  useEffect(() => {
    const timer = window.setTimeout(postDrafts, 150)
    return () => window.clearTimeout(timer)
  }, [postDrafts, design])

  // Paced: the design on the next frame, the latest of a burst.
  useEffect(() => {
    if (!paced) return
    const frame = requestAnimationFrame(postDesign)
    return () => cancelAnimationFrame(frame)
  }, [paced, design, postDesign])

  useEffect(
    () => () => {
      if (drawing.current) clearTimeout(drawing.current)
    },
    []
  )

  // The portal announces readiness from each document the frame loads (a
  // save-triggered reload, a theme switch); that document starts from the
  // saved config, so re-send any unsaved edits to keep them on screen.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const frame = iframeRef.current?.contentWindow
      if (event.origin !== window.location.origin || !frame || event.source !== frame) return
      const type = (event.data as { type?: string } | null)?.type
      if (type === 'quackback:preview-ready') {
        frameCss.current = ''
        frameDraft.current = null
        frameDesign.current = null
        frameDesignText.current = 'null'
        if (drawing.current) clearTimeout(drawing.current)
        drawing.current = null
        postDrafts()
        postDesign()
        onReady?.(frame)
      } else if (type === 'quackback:preview-drawn' && drawing.current) {
        clearTimeout(drawing.current)
        drawing.current = null
        postDesign()
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [iframeRef, postDrafts, postDesign, onReady])
}
