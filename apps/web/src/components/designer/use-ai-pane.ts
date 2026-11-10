import { useCallback, useEffect, useRef, useState } from 'react'
import { useSessionContext } from '@/lib/client/hooks/use-root-context'
import { readAiPane } from '@/lib/shared/design/builder-chrome'
import { AI_BOX_ID } from './designer-ai'
import { cycleRegions } from './regions'

/** Where the builder remembers Ask AI's pane, collapsed or not and its width, per person. */
export const aiPaneKey = (userId: string) => `quackback:designer-ai-pane:${userId}`

/** Fields and the frame keep their own keys; "/" there is a character, not a shortcut. */
const TYPING = 'input, textarea, select, [contenteditable], [role=dialog], iframe'

export interface AiPane {
  collapsed: boolean
  width: number
  /** Whether its edge is being dragged, when it follows the pointer without easing. */
  resizing: boolean
  /** Opens the pane, if collapsed, with the request box focused. */
  expand: () => void
  collapse: () => void
  /** A width while the edge is dragged; `done` remembers it. */
  resize: (width: number, done?: boolean) => void
  setResizing: (resizing: boolean) => void
}

/**
 * Ask AI's pane on the left: collapsed to a rail or open, and how wide,
 * remembered on this device for the person signed in (read after the first
 * paint, so the server's page and the browser's agree). "/" anywhere outside
 * a field opens it with the request box focused; F6 walks the regions.
 */
export function useAiPane(previewing: boolean, onShow: () => void = () => {}): AiPane {
  const session = useSessionContext()
  const userId = session?.user?.id ?? null
  const [state, setState] = useState(() => readAiPane(null))
  const [resizing, setResizing] = useState(false)
  useEffect(() => {
    if (!userId) return
    try {
      setState(readAiPane(localStorage.getItem(aiPaneKey(userId))))
    } catch {
      // Storage closed: the pane opens as usual.
    }
  }, [userId])
  const remember = useCallback(
    (next: { collapsed: boolean; width: number }) => {
      setState(next)
      if (!userId) return
      try {
        localStorage.setItem(aiPaneKey(userId), JSON.stringify(next))
      } catch {
        // Storage closed: forgotten next time, which is the lesser harm.
      }
    },
    [userId]
  )
  const latest = useRef(state)
  latest.current = state
  const show = useRef(onShow)
  show.current = onShow
  const expand = useCallback(() => {
    if (latest.current.collapsed) remember({ ...latest.current, collapsed: false })
    show.current()
    requestAnimationFrame(() => document.getElementById(AI_BOX_ID)?.focus())
  }, [remember])
  const collapse = useCallback(() => remember({ ...latest.current, collapsed: true }), [remember])
  const resize = useCallback(
    (width: number, done = true) =>
      done ? remember({ ...latest.current, width }) : setState({ ...latest.current, width }),
    [remember]
  )
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      cycleRegions(event)
      if (event.key !== '/' || event.defaultPrevented || previewing) return
      if ((event.target as Element | null)?.closest?.(TYPING)) return
      event.preventDefault()
      expand()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [previewing, expand])
  return { ...state, resizing, expand, collapse, resize, setResizing }
}
