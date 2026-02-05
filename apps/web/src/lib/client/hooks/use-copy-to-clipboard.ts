import { useCallback, useState } from 'react'

export function useCopyToClipboard(resetMs = 2000) {
  const [copied, setCopied] = useState(false)

  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), resetMs)
        return true
      } catch (err) {
        console.error('Failed to copy:', err)
        return false
      }
    },
    [resetMs]
  )

  const reset = useCallback(() => setCopied(false), [])

  return { copied, copy, reset }
}
