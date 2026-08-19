import { useCallback, useEffect, useRef, useState } from 'react'

export function useCopyToClipboard(resetMs = 2000) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  // Clear any pending reset timer on unmount so it can't fire setState
  // against an unmounted component.
  useEffect(() => clearTimer, [clearTimer])

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text)
        clearTimer()
        setCopied(true)
        timerRef.current = setTimeout(() => {
          timerRef.current = null
          setCopied(false)
        }, resetMs)
        return true
      } catch (err) {
        console.error('Failed to copy:', err)
        return false
      }
    },
    [resetMs, clearTimer]
  )

  const reset = useCallback(() => {
    clearTimer()
    setCopied(false)
  }, [clearTimer])

  return { copied, copy, reset }
}
