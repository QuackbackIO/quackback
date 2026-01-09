import { useState, useEffect } from 'react'

const NAV_CONTEXT_KEY = 'feedback-nav-context'
const DEFAULT_BACK_URL = '/admin/feedback'

export interface NavigationContext {
  position: number
  total: number
  prevId: string | null
  nextId: string | null
  backUrl: string
}

interface StoredContext {
  postIds: string[]
  backUrl: string
}

export function saveNavigationContext(postIds: string[], backUrl: string): void {
  if (typeof window === 'undefined') return
  try {
    sessionStorage.setItem(NAV_CONTEXT_KEY, JSON.stringify({ postIds, backUrl }))
  } catch {
    // Ignore storage errors
  }
}

function getStoredContext(): StoredContext | null {
  if (typeof window === 'undefined') return null
  try {
    const stored = sessionStorage.getItem(NAV_CONTEXT_KEY)
    return stored ? JSON.parse(stored) : null
  } catch {
    return null
  }
}

function buildNavigationContext(
  currentPostId: string,
  stored: StoredContext | null
): NavigationContext {
  const postIds = stored?.postIds ?? []
  const backUrl = stored?.backUrl || DEFAULT_BACK_URL
  const currentIndex = postIds.indexOf(currentPostId)

  if (postIds.length === 0 || currentIndex === -1) {
    return {
      position: 0,
      total: postIds.length,
      prevId: null,
      nextId: null,
      backUrl,
    }
  }

  return {
    position: currentIndex + 1,
    total: postIds.length,
    prevId: postIds[currentIndex - 1] ?? null,
    nextId: postIds[currentIndex + 1] ?? null,
    backUrl,
  }
}

/**
 * Hook to get navigation context for prev/next navigation on detail page.
 * Reads from sessionStorage after mount (client-side only).
 */
export function useNavigationContext(currentPostId: string): NavigationContext {
  const [stored, setStored] = useState<StoredContext | null>(null)

  useEffect(() => {
    setStored(getStoredContext())
  }, [])

  return buildNavigationContext(currentPostId, stored)
}
