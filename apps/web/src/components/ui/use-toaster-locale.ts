import { useEffect } from 'react'

/**
 * Names the toast region in this surface's language while it is mounted. The
 * toaster loads after the page, so this reaches it the same way: importing it
 * here would put the toaster's chunk in every admin page's preloads.
 */
export function useToasterLocale(locale: string) {
  useEffect(() => {
    let active = true
    let release: (() => void) | undefined
    void import('./sonner').then(({ setToasterLocale }) => {
      if (active) release = setToasterLocale(locale)
    })
    return () => {
      active = false
      release?.()
    }
  }, [locale])
}
