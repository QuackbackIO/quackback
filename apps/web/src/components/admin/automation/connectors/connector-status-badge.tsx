import { CheckIcon, ExclamationCircleIcon } from '@heroicons/react/24/outline'
import { Badge } from '@/components/ui/badge'
import type { ConnectorStatus } from '@/lib/shared/assistant/connectors'

export function ConnectorStatusBadge({ status }: { status: ConnectorStatus }) {
  if (status === 'connected') {
    return (
      <Badge
        size="sm"
        className="gap-1 border-transparent bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
      >
        <CheckIcon className="size-3" />
        Connected
      </Badge>
    )
  }
  if (status === 'error') {
    return (
      <Badge
        size="sm"
        className="gap-1 border-transparent bg-amber-500/10 text-amber-800 dark:text-amber-300"
      >
        <ExclamationCircleIcon className="size-3" />
        Needs attention
      </Badge>
    )
  }
  return <Badge size="sm">Disabled</Badge>
}
