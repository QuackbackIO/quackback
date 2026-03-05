import { useQuery } from '@tanstack/react-query'
import { SparklesIcon } from '@heroicons/react/24/solid'
import { signalQueries } from '@/lib/client/queries/signals'
import { SIGNAL_DISPLAY } from '@/components/admin/feedback/signal-config'
import type { AiSignalRow } from '@/lib/server/domains/signals'
import type { PostId } from '@quackback/ids'

interface PostSignalsPanelProps {
  postId: PostId
}

/**
 * L3: AI Insights panel shown on the post detail page.
 * Displays all pending signals for the current post.
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

      <div className="space-y-2">
        {signals.map((signal) => (
          <SignalRow key={signal.id} signal={signal} />
        ))}
      </div>
    </div>
  )
}

function SignalRow({ signal }: { signal: AiSignalRow }) {
  const payload = signal.payload
  const config = SIGNAL_DISPLAY[signal.type]

  switch (signal.type) {
    case 'duplicate': {
      const confidence = payload.confidence as number | undefined
      const pct = confidence ? `${Math.round(confidence * 100)}%` : null
      return (
        <div className="text-sm text-muted-foreground">
          <span className={`${config.color} font-medium`}>Possible duplicate</span>
          {pct && <span className="ml-1.5 text-muted-foreground/60">({pct} match)</span>}
        </div>
      )
    }
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
