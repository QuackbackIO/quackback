import { useCallback, useEffect, useRef, useState } from 'react'
import { trackBuilder } from '@/lib/client/builder-events'
import { locationOfPath, type CanvasLocation, type DesignerPage } from '@/lib/shared/design/outline'

const same = (a: CanvasLocation | null, b: CanvasLocation | null) =>
  !!a && !!b && a.page === b.page && a.item === b.item

/**
 * Preview follows the visitor: the frame says where it went, and leaving
 * Preview keeps the builder there, with a way back to where Preview began.
 * Only pages the builder draws are followed; anywhere else keeps the last.
 */
export function usePreviewFollow({
  previewing,
  here,
  pages,
  homeOn,
  setPage,
}: {
  previewing: boolean
  /** Where the builder is. */
  here: CanvasLocation
  pages: readonly DesignerPage[]
  homeOn: boolean
  setPage: (page: DesignerPage, item?: string | null) => void
}) {
  const began = useRef<CanvasLocation | null>(null)
  const reached = useRef<CanvasLocation | null>(null)
  const [note, setNote] = useState<{ from: CanvasLocation; at: CanvasLocation } | null>(null)

  const latest = useRef({ here, setPage })
  latest.current = { here, setPage }
  useEffect(() => {
    if (previewing) {
      began.current = latest.current.here
      reached.current = latest.current.here
      setNote(null)
      return
    }
    const from = began.current
    const at = reached.current
    began.current = null
    reached.current = null
    if (!from || !at || same(from, at)) return
    latest.current.setPage(at.page, at.item)
    setNote({ from, at })
  }, [previewing])

  /** Where the frame says it is now. */
  const onLocation = useCallback(
    (path: string) => {
      const at = locationOfPath(path, homeOn)
      if (!began.current || !at || !pages.includes(at.page)) return
      if (at.page !== reached.current?.page)
        trackBuilder('designer_page_switched', { page: at.page, via: 'preview' })
      reached.current = at
    },
    [homeOn, pages]
  )

  // The note stays only while the builder is where Preview left it.
  const shown = note && same(note.at, here) ? note : null
  const back = useCallback(() => {
    if (!note) return
    latest.current.setPage(note.from.page, note.from.item)
    setNote(null)
  }, [note])
  return { onLocation, note: shown, back }
}
