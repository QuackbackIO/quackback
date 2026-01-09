import { useState, useEffect } from 'react'
import { useSearch } from '@tanstack/react-router'
import { CheckCircleIcon, XMarkIcon } from '@heroicons/react/24/solid'

interface UnsubscribeBannerProps {
  postId: string
}

export function UnsubscribeBanner({ postId }: UnsubscribeBannerProps) {
  const search = useSearch({ strict: false }) as any
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (search?.unsubscribed === 'true') {
      setVisible(true)
      // Remove the query param from URL without navigation
      const url = new URL(window.location.href)
      url.searchParams.delete('unsubscribed')
      window.history.replaceState({}, '', url.pathname)
    }
  }, [search, postId])

  if (!visible) {
    return null
  }

  return (
    <div className="mb-4 flex items-center justify-between gap-4 [border-radius:var(--radius)] bg-success/10 border border-success/20 px-4 py-3">
      <div className="flex items-center gap-3">
        <CheckCircleIcon className="h-5 w-5 text-success flex-shrink-0" />
        <p className="text-sm text-foreground">
          You&apos;ve been unsubscribed from this post. Use the bell icon to resubscribe.
        </p>
      </div>
      <button
        onClick={() => setVisible(false)}
        className="flex-shrink-0 text-success hover:text-success/80 transition-colors"
        aria-label="Dismiss"
      >
        <XMarkIcon className="h-4 w-4" />
      </button>
    </div>
  )
}
