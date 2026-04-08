import { useState } from 'react'
import { HandThumbUpIcon, HandThumbDownIcon } from '@heroicons/react/24/outline'
import {
  HandThumbUpIcon as HandThumbUpSolid,
  HandThumbDownIcon as HandThumbDownSolid,
} from '@heroicons/react/24/solid'
import { recordArticleFeedbackFn } from '@/lib/server/functions/help-center'
import type { HelpCenterArticleId } from '@quackback/ids'

interface HelpCenterArticleFeedbackProps {
  articleId: string
}

export function HelpCenterArticleFeedback({ articleId }: HelpCenterArticleFeedbackProps) {
  const [feedback, setFeedback] = useState<'helpful' | 'not-helpful' | null>(null)
  const [isPending, setIsPending] = useState(false)

  const handleFeedback = async (helpful: boolean) => {
    if (isPending) return

    const newFeedback = helpful ? 'helpful' : 'not-helpful'
    if (feedback === newFeedback) return

    setIsPending(true)
    try {
      await recordArticleFeedbackFn({
        data: { articleId: articleId as HelpCenterArticleId, helpful },
      })

      setFeedback(newFeedback)
    } catch {
      // Silently fail -- non-critical
    } finally {
      setIsPending(false)
    }
  }

  return (
    <div className="mt-10 pt-8 border-t border-border/40 flex flex-col items-center text-center">
      <p className="text-sm text-muted-foreground mb-3">Was this article helpful?</p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => handleFeedback(true)}
          disabled={isPending}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm transition-colors disabled:opacity-50 ${
            feedback === 'helpful'
              ? 'bg-green-500/10 text-green-600 dark:text-green-400'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          }`}
        >
          {feedback === 'helpful' ? (
            <HandThumbUpSolid className="h-4 w-4" />
          ) : (
            <HandThumbUpIcon className="h-4 w-4" />
          )}
          Yes
        </button>
        <button
          type="button"
          onClick={() => handleFeedback(false)}
          disabled={isPending}
          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm transition-colors disabled:opacity-50 ${
            feedback === 'not-helpful'
              ? 'bg-red-500/10 text-red-600 dark:text-red-400'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          }`}
        >
          {feedback === 'not-helpful' ? (
            <HandThumbDownSolid className="h-4 w-4" />
          ) : (
            <HandThumbDownIcon className="h-4 w-4" />
          )}
          No
        </button>
      </div>
      {feedback && (
        <p className="text-xs text-muted-foreground/60 mt-2">Thanks for your feedback!</p>
      )}
    </div>
  )
}
