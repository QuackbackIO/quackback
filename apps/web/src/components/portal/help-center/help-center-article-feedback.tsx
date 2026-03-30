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
  helpfulCount: number
  notHelpfulCount: number
}

export function HelpCenterArticleFeedback({
  articleId,
  helpfulCount: initialHelpful,
  notHelpfulCount: initialNotHelpful,
}: HelpCenterArticleFeedbackProps) {
  const [feedback, setFeedback] = useState<'helpful' | 'not-helpful' | null>(null)
  const [isPending, setIsPending] = useState(false)
  const [helpfulCount, setHelpfulCount] = useState(initialHelpful)
  const [notHelpfulCount, setNotHelpfulCount] = useState(initialNotHelpful)

  const handleFeedback = async (helpful: boolean) => {
    if (isPending) return

    const newFeedback = helpful ? 'helpful' : 'not-helpful'
    if (feedback === newFeedback) return

    setIsPending(true)
    try {
      await recordArticleFeedbackFn({
        data: { articleId: articleId as HelpCenterArticleId, helpful },
      })

      // Update counts optimistically
      if (feedback === null) {
        if (helpful) setHelpfulCount((c) => c + 1)
        else setNotHelpfulCount((c) => c + 1)
      } else {
        if (helpful) {
          setHelpfulCount((c) => c + 1)
          setNotHelpfulCount((c) => Math.max(0, c - 1))
        } else {
          setNotHelpfulCount((c) => c + 1)
          setHelpfulCount((c) => Math.max(0, c - 1))
        }
      }
      setFeedback(newFeedback)
    } catch {
      // Silently fail — non-critical
    } finally {
      setIsPending(false)
    }
  }

  return (
    <div className="mt-10 pt-8 border-t border-border/40">
      <p className="text-sm font-medium text-foreground mb-3">Was this article helpful?</p>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => handleFeedback(true)}
          disabled={isPending}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/50 text-sm text-muted-foreground hover:text-foreground hover:border-border transition-colors disabled:opacity-50"
        >
          {feedback === 'helpful' ? (
            <HandThumbUpSolid className="h-4 w-4 text-primary" />
          ) : (
            <HandThumbUpIcon className="h-4 w-4" />
          )}
          Yes{' '}
          {helpfulCount > 0 && (
            <span className="text-xs text-muted-foreground/60">({helpfulCount})</span>
          )}
        </button>
        <button
          type="button"
          onClick={() => handleFeedback(false)}
          disabled={isPending}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border/50 text-sm text-muted-foreground hover:text-foreground hover:border-border transition-colors disabled:opacity-50"
        >
          {feedback === 'not-helpful' ? (
            <HandThumbDownSolid className="h-4 w-4 text-destructive" />
          ) : (
            <HandThumbDownIcon className="h-4 w-4" />
          )}
          No{' '}
          {notHelpfulCount > 0 && (
            <span className="text-xs text-muted-foreground/60">({notHelpfulCount})</span>
          )}
        </button>
      </div>
      {feedback && (
        <p className="text-xs text-muted-foreground/60 mt-2">Thanks for your feedback!</p>
      )}
    </div>
  )
}
