import { useQuery } from '@tanstack/react-query'
import { SparklesIcon } from '@heroicons/react/24/solid'
import { signalQueries } from '@/lib/client/queries/signals'
import { SIGNAL_DISPLAY } from '@/components/admin/feedback/signal-config'
import { DuplicateSignalCard } from '@/components/admin/feedback/detail/duplicate-signal-card'
import type { AiSignalRow } from '@/lib/server/domains/signals'
import type { PostId } from '@quackback/ids'

interface PostSignalsPanelProps {
  postId: PostId
}

/**
 * L3: AI Insights panel shown on the post detail page.
 *
 * Dispatches to type-specific card components. Each card owns
 * its own data fetching and actions — the signal is a thin pointer,
 * the card hydrates the full context from the relevant domain service.
 */
export function PostSignalsPanel({ postId }: PostSignalsPanelProps) {
  const { data: signals } = useQuery(signalQueries.forPost(postId))

  if (!signals || signals.length === 0) return null

  return (
    <div className="mx-6 mb-4 rounded-lg border border-border/30 bg-muted/5 p-4">
      <div className="flex items-center gap-2 mb-3">
        <SparklesIcon className="size-3.5 text-amber-500/80 shrink-0" />
        <span className="text-xs font-medium text-muted-foreground/70">AI Insights</span>
      </div>

      <div className="divide-y divide-border/20">
        {signals.map((signal) => (
          <div key={signal.id} className="py-3 first:pt-0 last:pb-0">
            <SignalRow signal={signal} postId={postId} />
          </div>
        ))}
      </div>
    </div>
  )
}

function SignalRow({ signal, postId }: { signal: AiSignalRow; postId: PostId }) {
  if (signal.type === 'duplicate') {
    return <DuplicateSignalCard signal={signal} postId={postId} />
  }
  return <GenericSignalRow signal={signal} />
}

function GenericSignalRow({ signal }: { signal: AiSignalRow }) {
  const payload = signal.payload
  const config = SIGNAL_DISPLAY[signal.type]

  switch (signal.type) {
    case 'sentiment':
      return (
        <p className="text-sm text-foreground/80">
          <span className={`${config.color} font-medium`}>
            {(payload.label as string) || 'Negative sentiment'}
          </span>
        </p>
      )
    case 'categorize':
      return (
        <p className="text-sm text-foreground/80">
          <span className={`${config.color} font-medium`}>Suggested board: </span>
          {(payload.suggestedBoardName as string) || 'Unknown'}
        </p>
      )
    case 'trend':
      return (
        <p className="text-sm text-foreground/80">
          <span className={`${config.color} font-medium`}>Trending: </span>
          {(payload.velocity as number) || 0} similar posts in the last 7 days
        </p>
      )
    case 'response_draft':
      return (
        <p className="text-sm text-foreground/80">
          <span className={`${config.color} font-medium`}>Draft response ready</span>
        </p>
      )
  }
}
