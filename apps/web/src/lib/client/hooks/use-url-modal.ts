import { useState, useEffect, useCallback, startTransition } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ensureTypeId, type IdPrefix } from '@quackback/ids'

interface UseUrlModalOptions {
  /** The ID from the URL search param (may be undefined when modal is closed) */
  urlId: string | undefined
  /** TypeID prefix for validation (e.g. 'post', 'changelog') */
  idPrefix: IdPrefix
  /** The search param key to clear when closing (e.g. 'post', 'entry') */
  searchParam: string
  /** The route to navigate to when closing */
  route: string
  /** Current route search params */
  search: Record<string, unknown>
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
 * Used by PostModal, ChangelogModal, and RoadmapModal.
 */
export function useUrlModal<T extends string>({
  urlId,
  idPrefix,
  searchParam,
  route,
  search,
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

  // Close modal instantly, then update URL in background
  const close = useCallback(() => {
    setLocalId(undefined)
    startTransition(() => {
      const { [searchParam]: _, ...restSearch } = search
      navigate({
        to: route,
        search: restSearch,
        replace: true,
      })
    })
  }, [navigate, search, searchParam, route])

  // Navigate to a different item (instant UI, background URL update)
  const navigateTo = useCallback(
    (newId: string) => {
      setLocalId(newId)
      startTransition(() => {
        navigate({
          to: route,
          search: { ...search, [searchParam]: newId },
          replace: true,
        })
      })
    },
    [navigate, search, searchParam, route]
  )

  return { open, validatedId, close, navigateTo }
}
