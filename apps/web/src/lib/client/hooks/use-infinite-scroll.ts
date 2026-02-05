import { useEffect, useRef } from 'react'

interface UseInfiniteScrollOptions {
  /** Whether there are more items to load */
  hasMore: boolean
  /** Whether a fetch is currently in progress */
  isFetching?: boolean
  /** Called when the sentinel enters the viewport */
  onLoadMore: () => void
  /** Root margin for early triggering (default: '100px') */
  rootMargin?: string
  /** Intersection threshold (default: 0) */
  threshold?: number
}

export function useInfiniteScroll({
  hasMore,
  isFetching = false,
  onLoadMore,
  rootMargin = '100px',
  threshold = 0,
}: UseInfiniteScrollOptions) {
  const sentinelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !hasMore) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !isFetching) {
          onLoadMore()
        }
      },
      { rootMargin, threshold }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, isFetching, onLoadMore, rootMargin, threshold])

  return sentinelRef
}
