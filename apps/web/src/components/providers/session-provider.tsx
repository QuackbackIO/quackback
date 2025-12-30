'use client'

import { useLayoutEffect, useRef } from 'react'
import { authClient } from '@/lib/auth/client'

interface SessionProviderProps {
  children: React.ReactNode
  /** Server-fetched session data for SSR hydration (from auth.api.getSession) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  initialSession?: { user: any; session: any } | null
}

// Module-level flag to ensure hydration only happens once per page load
// This prevents double-hydration in React strict mode and across navigation
let hasHydratedGlobal = false

/**
 * SessionProvider hydrates the better-auth session store with server-fetched data.
 *
 * The hydration happens in useLayoutEffect, which runs AFTER React hydration
 * but BEFORE browser paint. Components should use the `isHydrated` pattern
 * to use SSR props during initial render, then switch to session data.
 *
 * Usage:
 * ```tsx
 * // In a server component
 * const session = await auth.api.getSession({ headers: await headers() })
 *
 * // Pass to client
 * <SessionProvider initialSession={session}>
 *   {children}
 * </SessionProvider>
 * ```
 */
export function SessionProvider({ children, initialSession }: SessionProviderProps) {
  const hasHydrated = useRef(false)

  // Hydrate the session atom after React hydration but before paint
  // Components using useSession should use isHydrated pattern to avoid mismatch
  useLayoutEffect(() => {
    if (hasHydrated.current || hasHydratedGlobal) return
    hasHydrated.current = true
    hasHydratedGlobal = true

    // If we have server session data, hydrate the store
    if (initialSession) {
      // Access the internal session atom and set it directly
      // The atom is named 'session' in pluginsAtoms (see better-auth source)
      const sessionAtom = authClient.$store.atoms['session']
      if (sessionAtom) {
        // Get existing atom value to preserve the refetch function
        const existingValue = sessionAtom.get()
        // The atom expects { data, error, isPending, isRefetching, refetch } structure
        sessionAtom.set({
          ...existingValue,
          data: initialSession,
          error: null,
          isPending: false,
        })
      }
    }
  }, [initialSession])

  return <>{children}</>
}
