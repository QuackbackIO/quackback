import { useState } from 'react'
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
      // non-critical
    } finally {
      setIsPending(false)
    }
  }

  const subtitle =
    feedback === null
      ? 'Your feedback shapes what we write next.'
      : feedback === 'helpful'
        ? 'Thanks — glad it landed.'
        : "Noted. We'll revisit this article."

  return (
    <div className="mt-10 rounded-xl border border-border/50 bg-card px-5 py-4 flex items-center justify-between gap-4 flex-wrap">
      <div>
        <p className="text-sm font-semibold text-foreground">Was this helpful?</p>
        <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={() => handleFeedback(true)}
          disabled={isPending}
          className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all disabled:opacity-50 ${
            feedback === 'helpful'
              ? 'bg-primary/10 border border-primary/20 text-primary'
              : 'bg-muted/60 border border-border/60 text-foreground hover:bg-muted'
          }`}
        >
          👍 Yes
        </button>
        <button
          type="button"
          onClick={() => handleFeedback(false)}
          disabled={isPending}
          className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-sm font-medium transition-all disabled:opacity-50 ${
            feedback === 'not-helpful'
              ? 'bg-primary/10 border border-primary/20 text-primary'
              : 'bg-muted/60 border border-border/60 text-foreground hover:bg-muted'
          }`}
        >
          👎 No
        </button>
      </div>
    </div>
  )
}
