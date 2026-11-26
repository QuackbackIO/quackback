import { useEffect, useRef } from 'react'
import { useRouter } from '@tanstack/react-router'
import { frameHoldsPortalSession } from '@/lib/client/widget-frame'

/**
 * When the server handed the frame a portal session that the frame then
 * refused (its parent page is on another origin), the server-rendered data
 * still reflects that session. Re-run the loaders once: by then the frame's
 * calls carry no cookies and the session is not offered again, so the data
 * comes back anonymous. Runs after the provider below has decided, and at
 * most once per mount.
 */
export function useReseedOnPortalRefusal(serverPortalSessionToken: string | null | undefined) {
  const router = useRouter()
  const reseeded = useRef(false)
  useEffect(() => {
    if (reseeded.current || !serverPortalSessionToken || frameHoldsPortalSession()) return
    reseeded.current = true
    void router.invalidate()
  }, [serverPortalSessionToken, router])
}
