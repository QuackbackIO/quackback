import { GlobeAltIcon, LockClosedIcon, TagIcon, UsersIcon } from '@heroicons/react/24/solid'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import { ACCESS_TIER_RANK, type AccessTier } from '@/lib/shared/db-types'

/**
 * 4-segment radio control for picking an AccessTier.
 *
 * Pure presentation — no server calls. Composed by BoardAccessForm to
 * render the view / comment / submit row of the per-board access matrix.
 *
 * `minTier` dims (and disables) any option whose rank is below the
 * supplied tier — used to enforce the rank invariant visually
 * (derived rows can't be more permissive than view).
 *
 * `disabled` blanket-disables every option; used while the parent
 * mutation is in-flight or when the workspace kill-switch overrides
 * the per-board setting.
 */

interface TierSelectProps {
  value: AccessTier
  onChange: (next: AccessTier) => void
  /** Tier options with rank < minTier are dimmed and disabled. */
  minTier?: AccessTier
  disabled?: boolean
  ariaLabel: string
}

interface TierOption {
  value: AccessTier
  label: string
  icon: React.ComponentType<{ className?: string }>
}

const OPTIONS: TierOption[] = [
  { value: 'anonymous', label: 'Anyone', icon: GlobeAltIcon },
  { value: 'authenticated', label: 'Signed-in', icon: UsersIcon },
  { value: 'segments', label: 'Segments', icon: TagIcon },
  { value: 'team', label: 'Team only', icon: LockClosedIcon },
]

export function TierSelect({ value, onChange, minTier, disabled, ariaLabel }: TierSelectProps) {
  const minRank = minTier ? ACCESS_TIER_RANK[minTier] : 0
  return (
    <RadioGroup
      value={value}
      onValueChange={(next) => onChange(next as AccessTier)}
      aria-label={ariaLabel}
      className="grid grid-cols-2 gap-2 sm:grid-cols-4"
    >
      {OPTIONS.map((opt) => {
        const id = `tier-${ariaLabel.replace(/\s+/g, '-')}-${opt.value}`
        const Icon = opt.icon
        const optionDisabled = !!disabled || ACCESS_TIER_RANK[opt.value] < minRank
        return (
          <Label
            key={opt.value}
            htmlFor={id}
            data-disabled={optionDisabled || undefined}
            className="flex items-center gap-2 rounded-lg border px-3 py-2 cursor-pointer hover:bg-muted/50 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 [&:has([data-state=checked])]:border-primary [&:has([data-state=checked])]:bg-primary/5"
          >
            <RadioGroupItem value={opt.value} id={id} disabled={optionDisabled} />
            <Icon className="h-4 w-4" />
            <span className="text-sm">{opt.label}</span>
          </Label>
        )
      })}
    </RadioGroup>
  )
}
