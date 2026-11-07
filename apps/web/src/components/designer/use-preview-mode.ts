import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Preview, on or off. Leaving it hands focus back to the Preview button once
 * the top bar is drawn again, however it was left: from the top bar, or by
 * an Escape the frame passed on.
 */
export function usePreviewMode() {
  const [previewing, setPreviewing] = useState(false)
  const left = useRef(false)
  useEffect(() => {
    if (previewing || !left.current) return
    left.current = false
    document.querySelector<HTMLElement>('[data-preview]')?.focus()
  }, [previewing])
  const enter = useCallback(() => setPreviewing(true), [])
  const leave = useCallback(() => {
    left.current = true
    setPreviewing(false)
  }, [])
  return { previewing, enter, leave }
}
