import { useCallback, useEffect, useRef, useState } from 'react'
import type { PreviewEditTarget } from '@/components/public/preview-draft-context'
import { flashTargets, summariseChange } from './change-summary'
import type { PortalDraft } from './portal-draft'

/** A hand edit is outlined once the draft has been still this long. */
export const HAND_SETTLE_MS = 700
/** How often a settled edit checks again while a drag or typing goes on. */
const RECHECK_MS = 250
/** A mark for the next change is dropped if no change follows it this soon. */
const MARK_MS = 2000

/** A text field being typed in (sliders, switches and buttons are not). */
function typing(): boolean {
  const el = document.activeElement
  if (!el) return false
  if (el instanceof HTMLInputElement) {
    return !['range', 'checkbox', 'radio', 'button', 'color', 'file'].includes(el.type)
  }
  return el.closest('textarea, [contenteditable="true"], .cm-editor') !== null
}

/**
 * When the preview outlines what changed. A chat request or an import
 * (`flashNow` just before the draft changes) is outlined at once. A hand edit
 * is outlined once, when it has settled: the pointer lifted, the field left,
 * and the draft still for a moment, so a drag is one outline and not one per
 * frame. Undo and redo (`quietly`) are not outlined.
 *
 * Each outline compares the draft with the one last outlined, through the
 * same summary the chat's reply is made from.
 */
export function useChangeFlash(draft: PortalDraft) {
  const [flash, setFlash] = useState<{ targets: PreviewEditTarget[] } | null>(null)
  const settled = useRef(draft)
  const mark = useRef<{ how: 'now' | 'quiet'; at: number } | null>(null)
  const pointerDown = useRef(false)

  useEffect(() => {
    const down = () => (pointerDown.current = true)
    const up = () => (pointerDown.current = false)
    window.addEventListener('pointerdown', down, true)
    window.addEventListener('pointerup', up, true)
    window.addEventListener('pointercancel', up, true)
    return () => {
      window.removeEventListener('pointerdown', down, true)
      window.removeEventListener('pointerup', up, true)
      window.removeEventListener('pointercancel', up, true)
    }
  }, [])

  useEffect(() => {
    if (draft === settled.current) return
    const how = mark.current && Date.now() - mark.current.at < MARK_MS ? mark.current.how : null
    mark.current = null
    const outline = () => {
      const targets = flashTargets(summariseChange(settled.current, draft))
      settled.current = draft
      if (targets.length > 0) setFlash({ targets })
    }
    if (how === 'quiet') {
      settled.current = draft
      return
    }
    if (how === 'now') {
      outline()
      return
    }
    let timer = window.setTimeout(function attempt() {
      if (pointerDown.current || typing()) timer = window.setTimeout(attempt, RECHECK_MS)
      else outline()
    }, HAND_SETTLE_MS)
    return () => window.clearTimeout(timer)
  }, [draft])

  /** The next change to the draft is outlined at once. */
  const flashNow = useCallback(() => {
    mark.current = { how: 'now', at: Date.now() }
  }, [])
  /** The next change to the draft is not outlined. */
  const quietly = useCallback(() => {
    mark.current = { how: 'quiet', at: Date.now() }
  }, [])

  return { flash, flashNow, quietly }
}
