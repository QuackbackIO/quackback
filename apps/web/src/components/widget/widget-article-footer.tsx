import { useState } from 'react'
import { FormattedMessage } from 'react-intl'
import { HandThumbUpIcon, HandThumbDownIcon } from '@heroicons/react/24/outline'
import { ChatBubbleLeftRightIcon } from '@heroicons/react/24/solid'
import { recordArticleFeedbackFn } from '@/lib/server/functions/help-center'
import { getWidgetAuthHeaders } from '@/lib/client/widget-auth'
import { cn } from '@/lib/shared/utils'
import type { KbArticleId } from '@quackback/ids'

interface WidgetArticleFooterProps {
  articleId: string
  /** When set, offers "Still stuck? Ask a question" opening a new thread. */
  onAskQuestion?: () => void
}

/**
 * The exit ramp under a help article. An article either answered the question
 * or it didn't; this gives both outcomes somewhere to go — a one-tap helpful
 * vote (the same signal the portal collects) and a jump into the messenger
 * for the visitor who is still stuck. Kept to a single compact row: the
 * portal's reason textarea would crowd a 400px panel.
 */
export function WidgetArticleFooter({ articleId, onAskQuestion }: WidgetArticleFooterProps) {
  const [vote, setVote] = useState<'helpful' | 'not-helpful' | null>(null)
  const [pending, setPending] = useState(false)

  const cast = async (helpful: boolean) => {
    const next = helpful ? 'helpful' : 'not-helpful'
    if (pending || vote === next) return
    setPending(true)
    try {
      await recordArticleFeedbackFn({
        data: { articleId: articleId as KbArticleId, helpful },
        headers: getWidgetAuthHeaders(),
      })
      setVote(next)
    } catch {
      // Non-critical: the article is still readable, the CTA still works.
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="mt-6 rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {vote === null ? (
            <FormattedMessage id="widget.help.article.helpful" defaultMessage="Was this helpful?" />
          ) : vote === 'helpful' ? (
            <FormattedMessage
              id="widget.help.article.helpful.thanks"
              defaultMessage="Thanks — glad it helped."
            />
          ) : (
            <FormattedMessage
              id="widget.help.article.helpful.sorry"
              defaultMessage="Sorry about that."
            />
          )}
        </p>
        <div className="flex items-center gap-1 shrink-0" role="group">
          <VoteButton
            active={vote === 'helpful'}
            disabled={pending}
            onClick={() => cast(true)}
            label={
              <FormattedMessage
                id="widget.help.article.helpful.yes"
                defaultMessage="Yes, this helped"
              />
            }
          >
            <HandThumbUpIcon className="size-4" />
          </VoteButton>
          <VoteButton
            active={vote === 'not-helpful'}
            disabled={pending}
            onClick={() => cast(false)}
            label={
              <FormattedMessage
                id="widget.help.article.helpful.no"
                defaultMessage="No, this didn't help"
              />
            }
          >
            <HandThumbDownIcon className="size-4" />
          </VoteButton>
        </div>
      </div>
      {onAskQuestion && (
        <button
          type="button"
          onClick={onAskQuestion}
          className="mt-2 flex w-full items-center gap-2 rounded-md border border-border/50 bg-background px-2.5 py-2 text-start text-xs transition-colors hover:bg-muted/40"
        >
          <ChatBubbleLeftRightIcon className="size-4 shrink-0 text-primary" />
          <span className="min-w-0 flex-1">
            <span className="text-muted-foreground">
              <FormattedMessage id="widget.help.article.stillStuck" defaultMessage="Still stuck?" />
            </span>{' '}
            <span className="font-medium text-foreground">
              <FormattedMessage
                id="widget.help.article.askQuestion"
                defaultMessage="Ask us a question"
              />
            </span>
          </span>
        </button>
      )}
    </div>
  )
}

function VoteButton({
  active,
  disabled,
  onClick,
  label,
  children,
}: {
  active: boolean
  disabled: boolean
  onClick: () => void
  label: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        'flex size-7 items-center justify-center rounded-md border transition-colors disabled:opacity-60',
        active
          ? 'border-primary/40 bg-primary/15 text-foreground'
          : 'border-border/50 bg-background text-muted-foreground hover:bg-muted/40 hover:text-foreground'
      )}
    >
      {children}
      <span className="sr-only">{label}</span>
    </button>
  )
}
