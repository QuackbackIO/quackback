/**
 * Hook to lazily create an anonymous session before an action (vote, comment, post).
 *
 * Returns a stable callback that:
 * - Returns true immediately if a session already exists
 * - Creates an anonymous session via Better Auth if none exists
 * - Waits for the cookie to commit, then invalidates the router
 * - Returns false if session creation fails
 *
 * Used by AuthVoteButton, PostCard, and AuthCommentsSection.
 */

import { useCallback, useEffect, useRef } from 'react'
import { useRouter, useRouteContext } from '@tanstack/react-router'
import { authClient } from '@/lib/server/auth/client'

export function useEnsureAnonSession(): () => Promise<boolean> {
  const router = useRouter()
  const { session } = useRouteContext({ from: '__root__' })
  const hasSessionRef = useRef(!!session?.user)

  useEffect(() => {
    hasSessionRef.current = !!session?.user
  }, [session?.user])

  return useCallback(async (): Promise<boolean> => {
    if (hasSessionRef.current) return true
    try {
      const result = await authClient.signIn.anonymous()
      if (result.error) {
        console.error('[anon-session] Anonymous sign-in failed:', result.error)
        return false
      }
      hasSessionRef.current = true
      // Let the browser commit the session cookie before proceeding
      await new Promise((r) => setTimeout(r, 0))
      router.invalidate()
      return true
    } catch (error) {
      console.error('[anon-session] Anonymous sign-in failed:', error)
      return false
    }
  }, [router])
}
