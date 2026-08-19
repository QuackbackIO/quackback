import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { FormattedMessage, useIntl } from 'react-intl'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  recordArticleFeedbackFn,
  submitArticleFeedbackReasonFn,
} from '@/lib/server/functions/help-center'
import { ARTICLE_FEEDBACK_REASON_MAX_LENGTH } from '@/lib/shared/schemas/help-center'
import type { KbArticleFeedbackId, KbArticleId } from '@quackback/ids'

interface HelpCenterArticleFeedbackProps {
  articleId: string
  /** When set, a "not helpful" vote offers a contact-support pathway here. */
  supportHref?: string | null
}

export function HelpCenterArticleFeedback({
  articleId,
  supportHref,
}: HelpCenterArticleFeedbackProps) {
  const intl = useIntl()
  const [feedback, setFeedback] = useState<'helpful' | 'not-helpful' | null>(null)
  const [isPending, setIsPending] = useState(false)
  // Handle on the vote just cast. An anonymous visitor has no principal, so
  // this id is the only thing tying a reason back to their own vote.
  const [feedbackId, setFeedbackId] = useState<KbArticleFeedbackId | null>(null)
  const [reason, setReason] = useState('')
  const [reasonSent, setReasonSent] = useState(false)
  const [isSendingReason, setIsSendingReason] = useState(false)

  const handleFeedback = async (helpful: boolean) => {
    if (isPending) return
    const newFeedback = helpful ? 'helpful' : 'not-helpful'
    if (feedback === newFeedback) return
    setIsPending(true)
    try {
      // The vote lands on the click, before any typing: a visitor who never
      // writes a word still counts, and the reason stays optional.
      const result = await recordArticleFeedbackFn({
        data: { articleId: articleId as KbArticleId, helpful },
      })
      setFeedback(newFeedback)
      setFeedbackId((result.feedbackId as KbArticleFeedbackId) ?? null)
      setReason('')
      setReasonSent(false)
    } catch {
      // non-critical
    } finally {
      setIsPending(false)
    }
  }

  const handleSendReason = async () => {
    const trimmed = reason.trim()
    if (trimmed.length === 0 || !feedbackId || isSendingReason) return
    setIsSendingReason(true)
    try {
      await submitArticleFeedbackReasonFn({ data: { feedbackId, reason: trimmed } })
      setReasonSent(true)
    } catch {
      // non-critical
    } finally {
      setIsSendingReason(false)
    }
  }

  const subtitle =
    feedback === null
      ? 'Your feedback shapes what we write next.'
      : feedback === 'helpful'
        ? 'Thanks — glad it landed.'
        : "Noted. We'll revisit this article."

  const showReasonBox = feedback === 'not-helpful' && feedbackId !== null && !reasonSent

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
      {showReasonBox && (
        <div className="w-full border-t border-border/50 pt-3">
          <label
            htmlFor="hc-article-feedback-reason"
            className="text-sm font-medium text-foreground"
          >
            <FormattedMessage
              id="portal.hc.articleFeedback.reasonPrompt"
              defaultMessage="What were you looking for?"
            />
          </label>
          <Textarea
            id="hc-article-feedback-reason"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={ARTICLE_FEEDBACK_REASON_MAX_LENGTH}
            rows={3}
            className="mt-2 text-sm"
            placeholder={intl.formatMessage({
              id: 'portal.hc.articleFeedback.reasonPlaceholder',
              defaultMessage: 'Optional, but it tells us what to fix.',
            })}
          />
          <div className="mt-2 flex justify-end">
            <Button
              type="button"
              size="sm"
              onClick={handleSendReason}
              disabled={reason.trim().length === 0 || isSendingReason}
            >
              <FormattedMessage id="portal.hc.articleFeedback.reasonSend" defaultMessage="Send" />
            </Button>
          </div>
        </div>
      )}
      {reasonSent && (
        <div className="w-full border-t border-border/50 pt-3 text-sm text-muted-foreground">
          <FormattedMessage
            id="portal.hc.articleFeedback.reasonThanks"
            defaultMessage="Thanks — that goes to whoever maintains this article."
          />
        </div>
      )}
      {feedback === 'not-helpful' && supportHref && (
        <div className="w-full border-t border-border/50 pt-3 text-sm">
          <span className="text-muted-foreground">
            <FormattedMessage
              id="portal.hc.articleFeedback.stillStuck"
              defaultMessage="Still stuck?"
            />
          </span>{' '}
          <Link to={supportHref} className="font-medium text-primary hover:underline">
            <FormattedMessage
              id="portal.hc.articleFeedback.contactSupport"
              defaultMessage="Contact support"
            />
          </Link>
        </div>
      )}
    </div>
  )
}
