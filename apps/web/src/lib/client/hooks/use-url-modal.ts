import { useState, useEffect, useCallback, startTransition } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ensureTypeId, type IdPrefix } from '@quackback/ids'

interface UseUrlModalOptions {
  /** The ID from the URL search param (may be undefined when modal is closed) */
  urlId: string | undefined
  /** TypeID prefix for validation (e.g. 'post', 'changelog') */
  idPrefix: IdPrefix
  /** The search param that holds the ID (e.g. 'post', 'entry') */
  searchParam: string
}

interface UseUrlModalReturn<T> {
  /** Whether the modal is open */
  open: boolean
  /** Validated TypeID or null if invalid/closed */
  validatedId: T | null
  /** Close the modal (instant UI, background URL update) */
  close: () => void
  /** Navigate to a different item in the modal */
  navigateTo: (newId: string) => void
}

/**
 * Hook for URL-synced modals that handles local state for instant UI,
 * URL synchronization, and TypeID validation.
 *
 * Closing and moving rewrite only `searchParam` on the page the modal is open
 * over, from the location at the time of the navigation, so `close` and
 * `navigateTo` stay the same functions while the location changes.
 *
 * Used by PostModal, ChangelogModal, ArticleModal, RoadmapModal and
 * StatusIncidentModal.
 */
export function useUrlModal<T extends string>({
  urlId,
  idPrefix,
  searchParam,
}: UseUrlModalOptions): UseUrlModalReturn<T> {
  const navigate = useNavigate()

  // Local state for instant UI - syncs with URL
  const [localId, setLocalId] = useState<string | undefined>(urlId)
  const open = !!localId

  // Sync local state when URL changes (e.g., browser back/forward)
  useEffect(() => {
    setLocalId(urlId)
  }, [urlId])

  // Validate and convert ID
  let validatedId: T | null = null
  if (localId) {
    try {
      validatedId = ensureTypeId(localId, idPrefix) as T
    } catch {
      // Invalid ID format
    }
  }

  const setParam = useCallback(
    (value: string | undefined) => {
      startTransition(() => {
        navigate({
          to: '.',
          search: (prev) => {
            const next: Record<string, unknown> = { ...prev }
            if (value === undefined) delete next[searchParam]
            else next[searchParam] = value
            return next as typeof prev
          },
          replace: true,
        })
      })
    },
    [navigate, searchParam]
  )

  // Close modal instantly, then update URL in background
  const close = useCallback(() => {
    setLocalId(undefined)
    setParam(undefined)
  }, [setParam])

  // Navigate to a different item (instant UI, background URL update)
  const navigateTo = useCallback(
    (newId: string) => {
      setLocalId(newId)
      setParam(newId)
    },
    [setParam]
  )

  return { open, validatedId, close, navigateTo }
}
