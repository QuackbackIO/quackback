/**
 * Hook to lazily create an anonymous session before an action (vote, comment, post).
 *
 * Returns a stable callback that:
 * - Returns true immediately if a session already exists
 * - Creates an anonymous session via Better Auth if none exists
 * - Waits for the session cookie to be available via a verification request
 * - Returns false if session creation fails
 *
 * Used by AuthVoteButton, PostCard, and AuthCommentsSection.
 */

import { useCallback, useEffect, useRef } from 'react'
import { useRouteContext } from '@tanstack/react-router'
import { authClient } from '@/lib/server/auth/client'

export function useEnsureAnonSession(): () => Promise<boolean> {
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

      // Verify the session is actually available by fetching it.
      // The browser sets the cookie after the response, but we need to ensure
      // subsequent fetch requests include it. authClient.getSession() makes a
      // request that will include the new cookie, verifying it's working.
      const sessionResult = await authClient.getSession()
      if (sessionResult.error || !sessionResult.data?.user) {
        console.error('[anon-session] Session verification failed:', sessionResult.error)
        return false
      }

      hasSessionRef.current = true
      return true
    } catch (error) {
      console.error('[anon-session] Anonymous sign-in failed:', error)
      return false
    }
  }, [])
}
