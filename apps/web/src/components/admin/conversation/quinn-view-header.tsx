import { Link } from '@tanstack/react-router'
import { usePermission } from '@/lib/client/hooks/use-permission'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { cn } from '@/lib/shared/utils'

type QuinnBucket = 'resolved' | 'escalated' | 'pending'

/** Quinn-view outcome sub-filter. */
const QUINN_BUCKETS: { value: QuinnBucket | undefined; label: string }[] = [
  { value: undefined, label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'escalated', label: 'Escalated' },
  { value: 'resolved', label: 'Resolved' },
]

/**
 * The header of the Quinn activity view: the outcome sub-filter, and for
 * assistant managers a link to the Agent settings.
 */
export function QuinnViewHeader({
  value,
  counts,
  onChange,
}: {
  value?: QuinnBucket
  counts?: { resolved: number; escalated: number; pending: number }
  onChange: (value?: QuinnBucket) => void
}) {
  const canConfigure = usePermission(PERMISSIONS.ASSISTANT_MANAGE)
  const countFor = (v?: QuinnBucket): number | undefined => {
    if (!counts) return undefined
    return v ? counts[v] : counts.resolved + counts.escalated + counts.pending
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 pb-2 pt-1">
      {QUINN_BUCKETS.map((b) => {
        const active = value === b.value
        const n = countFor(b.value)
        return (
          <button
            key={b.label}
            type="button"
            onClick={() => onChange(b.value)}
            className={cn(
              'flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[13px] font-medium transition-colors',
              active
                ? 'bg-primary/15 text-primary'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground'
            )}
          >
            {b.label}
            {n != null && <span className="tabular-nums opacity-70">{n}</span>}
          </button>
        )
      })}
      {canConfigure && (
        <Link
          to="/admin/settings/agent"
          className="ms-auto rounded-full px-2.5 py-1 text-[13px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          Configure the agent
        </Link>
      )}
    </div>
  )
}
