import { Link } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { SparklesIcon } from '@heroicons/react/24/solid'
import { ArrowRightIcon } from '@heroicons/react/24/outline'
import { settingsQueries } from '@/lib/client/queries/settings'

/**
 * Warns that the AI agent takes priority over customer-facing workflows on
 * the same trigger when auto-reply is on (SUPPORT-PLATFORM-SPEC §4.7 Q2
 * doctrine). Hidden once the agent is off, or only greets without replying.
 */
export function AgentPriorityBanner() {
  const { data } = useSuspenseQuery(settingsQueries.widgetConfig())
  const assistant = data.messenger?.assistant
  if (!assistant?.enabled || !assistant?.respond) return null

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-card px-4 py-2.5 text-sm">
      <SparklesIcon className="h-4 w-4 text-primary shrink-0" />
      <span className="text-foreground">
        The AI agent is enabled and takes priority over any customer-facing workflow on the same
        trigger.
      </span>
      <Link
        to="/admin/automation/assistant"
        className="ml-auto inline-flex shrink-0 items-center gap-1 text-primary hover:underline font-medium"
      >
        Manage agent deployment
        <ArrowRightIcon className="h-3.5 w-3.5" />
      </Link>
    </div>
  )
}
