import { useCallback, useEffect, useRef, useState } from 'react'
import { parseWebsiteInput } from '@/lib/shared/website-branding'

/**
 * `?import=<website>` on the Customise editor: the launch plan's "Import from
 * {domain}" lands there with Import open and already reading that website.
 * Pressing that button was the person's choice, and an import only fills the
 * draft, so it starts without a second press.
 */
export function importDeepLinkSite(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined
  const site = raw.trim()
  return site.length <= 2048 && parseWebsiteInput(site) ? site : undefined
}

/**
 * The deep link's website, handed to the editor exactly once. `raw` is the
 * `?import=` value as the address carries it: the route keeps any string, and
 * what is not a website is dropped here. The param is cleared from the address
 * as it is read, so a reload, Back or a shared link to the editor never starts
 * the import again; and an editor that mounts a second time (it is keyed on
 * what it loads) gets nothing.
 */
export function useImportDeepLink(raw: string | undefined, clear: () => void) {
  // What the address carried when the page opened.
  const [linked] = useState(() => importDeepLinkSite(raw) ?? null)
  const taken = useRef(false)
  const clearRef = useRef(clear)
  clearRef.current = clear
  useEffect(() => {
    if (raw !== undefined) clearRef.current()
  }, [raw])
  return useCallback(() => {
    if (taken.current || !linked) return null
    taken.current = true
    return linked
  }, [linked])
}
