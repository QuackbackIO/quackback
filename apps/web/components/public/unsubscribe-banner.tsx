'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { CheckCircle, X } from 'lucide-react'

interface UnsubscribeBannerProps {
  postId: string
}

export function UnsubscribeBanner({ postId }: UnsubscribeBannerProps) {
  const searchParams = useSearchParams()
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (searchParams.get('unsubscribed') === 'true') {
      setVisible(true)
      // Remove the query param from URL without navigation
      const url = new URL(window.location.href)
      url.searchParams.delete('unsubscribed')
      window.history.replaceState({}, '', url.pathname)
    }
  }, [searchParams, postId])

  if (!visible) {
    return null
  }

  return (
    <div className="mb-4 flex items-center justify-between gap-4 rounded-lg bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900 px-4 py-3">
      <div className="flex items-center gap-3">
        <CheckCircle className="h-5 w-5 text-green-600 dark:text-green-400 flex-shrink-0" />
        <p className="text-sm text-green-800 dark:text-green-200">
          You&apos;ve been unsubscribed from this post. Use the bell icon to resubscribe.
        </p>
      </div>
      <button
        onClick={() => setVisible(false)}
        className="flex-shrink-0 text-green-600 dark:text-green-400 hover:text-green-800 dark:hover:text-green-200 transition-colors"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}
