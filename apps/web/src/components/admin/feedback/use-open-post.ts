import { useCallback, useLayoutEffect, useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { saveNavigationContext } from '@/components/admin/feedback/detail/use-navigation-context'

/**
 * Opens a post in the feedback modal by adding `post` to the URL, keeping the
 * rest of the list's search. The function is stable for the life of the list,
 * so the memoized rows that receive it do not render again when the URL or the
 * rows change; it reads the rows (saved for the modal's prev/next) when called.
 */
export function useOpenPost(posts: readonly { id: string }[]): (postId: string) => void {
  const navigate = useNavigate()
  const postsRef = useRef(posts)
  useLayoutEffect(() => {
    postsRef.current = posts
  }, [posts])

  return useCallback(
    (postId: string) => {
      const backUrl = window.location.pathname + window.location.search
      saveNavigationContext(
        postsRef.current.map((p) => p.id),
        backUrl
      )
      void navigate({
        from: '/admin/feedback',
        to: '/admin/feedback',
        search: (prev) => ({ ...prev, post: postId }),
      })
    },
    [navigate]
  )
}
