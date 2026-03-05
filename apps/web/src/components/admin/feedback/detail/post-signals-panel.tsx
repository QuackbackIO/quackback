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
    <div className="mx-6 mb-4 rounded-lg border border-amber-400/20 bg-amber-400/5 p-4">
      <div className="flex items-center gap-2 mb-3">
        <SparklesIcon className="h-4 w-4 text-amber-400" />
        <span className="text-sm font-medium text-foreground">AI Insights</span>
      </div>

      <div className="space-y-4">
        {signals.map((signal) => (
          <SignalRow key={signal.id} signal={signal} postId={postId} />
        ))}
      </div>
    </div>
  )
}

function SignalRow({ signal, postId }: { signal: AiSignalRow; postId: PostId }) {
  // Duplicate signals get the full actionable card
  if (signal.type === 'duplicate') {
    return <DuplicateSignalCard signal={signal} postId={postId} />
  }

  // Other signal types render as simple informational rows
  return <GenericSignalRow signal={signal} />
}

function GenericSignalRow({ signal }: { signal: AiSignalRow }) {
  const payload = signal.payload
  const config = SIGNAL_DISPLAY[signal.type]

  switch (signal.type) {
    case 'sentiment':
      return (
        <div className="text-sm text-muted-foreground">
          <span className={`${config.color} font-medium`}>
            {(payload.label as string) || 'Negative sentiment'}
          </span>
        </div>
      )
    case 'categorize':
      return (
        <div className="text-sm text-muted-foreground">
          <span className={`${config.color} font-medium`}>Suggested board: </span>
          <span>{(payload.suggestedBoardName as string) || 'Unknown'}</span>
        </div>
      )
    case 'trend':
      return (
        <div className="text-sm text-muted-foreground">
          <span className={`${config.color} font-medium`}>Trending: </span>
          <span>
            {(payload.velocity as number) || 0} similar posts in the last 7 days
          </span>
        </div>
      )
    case 'response_draft':
      return (
        <div className="text-sm text-muted-foreground">
          <span className={`${config.color} font-medium`}>Draft response ready</span>
        </div>
      )
  }
}
