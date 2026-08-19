/**
 * Lifecycle stepper for the incident editor: the visible path an incident
 * (investigating → identified → monitoring → resolved) or maintenance window
 * (scheduled → in progress → verifying → completed) moves through.
 *
 * It is also the composer's stage selector — clicking a step chooses the
 * status the next update posts as. This replaces the old status dropdown
 * buried in the "Post update" form, which hid resolving behind a select.
 */
import { CheckIcon } from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'
import {
  LIFECYCLE_COLORS,
  LIFECYCLE_LABELS,
  lifecycleValuesForKind,
  type StatusIncidentKind,
  type StatusIncidentLifecycle,
} from './status-admin-colors'

interface StatusLifecycleStepperProps {
  kind: StatusIncidentKind
  /** The incident's current lifecycle status. */
  current: StatusIncidentLifecycle
  /** The stage the next posted update will carry. */
  target: StatusIncidentLifecycle
  /** First-update timestamp per stage, for the hint line under passed steps. */
  reachedAt?: Partial<Record<StatusIncidentLifecycle, string>>
  onSelect: (stage: StatusIncidentLifecycle) => void
  disabled?: boolean
}

function shortTime(iso: string): string {
  const d = new Date(iso)
  const sameDay = d.toDateString() === new Date().toDateString()
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function StatusLifecycleStepper({
  kind,
  current,
  target,
  reachedAt,
  onSelect,
  disabled,
}: StatusLifecycleStepperProps) {
  const stages = lifecycleValuesForKind(kind)
  const currentIndex = stages.indexOf(current)

  return (
    <div className="flex items-start" role="radiogroup" aria-label="Lifecycle stage">
      {stages.map((stage, i) => {
        const isDone = i < currentIndex
        const isCurrent = i === currentIndex
        const isTarget = stage === target && !isCurrent
        const color = LIFECYCLE_COLORS[stage]

        return (
          <button
            key={stage}
            type="button"
            role="radio"
            aria-checked={stage === target}
            disabled={disabled}
            onClick={() => onSelect(stage)}
            className={cn(
              'group relative flex-1 flex flex-col items-center gap-1.5 pb-0.5 outline-none',
              disabled ? 'cursor-default' : 'cursor-pointer'
            )}
          >
            {/* connector to the next step */}
            {i < stages.length - 1 && (
              <span
                aria-hidden="true"
                className={cn(
                  'absolute top-3 left-[calc(50%+16px)] right-[calc(-50%+16px)] h-0.5 rounded-full',
                  isDone ? 'bg-emerald-500/50' : 'bg-border'
                )}
              />
            )}

            <span
              className={cn(
                'relative z-[1] flex h-6 w-6 items-center justify-center rounded-full border-2 text-[11px] font-semibold transition-colors',
                'bg-card text-muted-foreground border-border',
                (isDone || isCurrent) && 'text-white',
                isTarget && 'ring-2 ring-ring/40',
                !disabled && 'group-hover:border-foreground/40'
              )}
              style={
                isDone
                  ? { backgroundColor: '#10b981', borderColor: '#10b981' }
                  : isCurrent
                    ? { backgroundColor: color, borderColor: color }
                    : isTarget
                      ? { borderColor: color, color }
                      : undefined
              }
            >
              {isDone || isCurrent ? <CheckIcon className="h-3.5 w-3.5" /> : i + 1}
            </span>

            <span
              className={cn(
                'text-xs font-medium leading-none',
                isCurrent || isTarget ? 'text-foreground font-semibold' : 'text-muted-foreground'
              )}
            >
              {LIFECYCLE_LABELS[stage]}
            </span>

            <span className="text-[11px] leading-none text-muted-foreground/70 h-3">
              {isCurrent
                ? 'current'
                : isTarget
                  ? 'next update posts here'
                  : (isDone && reachedAt?.[stage] && shortTime(reachedAt[stage])) || ' '}
            </span>
          </button>
        )
      })}
    </div>
  )
}
