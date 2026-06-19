import { useMemo } from 'react'
import {
  GlobeAltIcon,
  UsersIcon,
  TagIcon,
  LockClosedIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'
import { useSegments } from '@/lib/client/hooks/use-segments-queries'
import { SegmentMultiSelect } from '@/components/admin/segments/segment-multi-select'
import type { AccessTier, ChangelogAccess } from '@/lib/shared/db-types'

interface TierOption {
  id: AccessTier
  label: string
  blurb: string
  icon: React.ComponentType<{ className?: string }>
}

// Mirrors the roadmap access tiers (view-only). Labels/icons match
// roadmap-access-control.tsx so the two surfaces read consistently.
const TIERS: readonly TierOption[] = [
  { id: 'anonymous', label: 'Public', blurb: 'Anyone · no sign-in', icon: GlobeAltIcon },
  { id: 'authenticated', label: 'Signed-in', blurb: 'Any logged-in user', icon: UsersIcon },
  { id: 'segments', label: 'Segments', blurb: 'Specific audiences', icon: TagIcon },
  { id: 'team', label: 'Private', blurb: 'Workspace members', icon: LockClosedIcon },
] as const

interface ChangelogAccessControlProps {
  value: ChangelogAccess
  onChange: (next: ChangelogAccess) => void
  disabled?: boolean
}

/**
 * Controlled audience-visibility editor for a changelog entry. Picks a tier
 * (Public / Signed-in / Segments / Private); when "Segments" is selected,
 * reveals a segment allowlist. Independent of the publish-state control — this
 * gates *who* sees a live entry.
 */
export function ChangelogAccessControl({ value, onChange, disabled }: ChangelogAccessControlProps) {
  const segmentsQuery = useSegments()
  const segments = useMemo(
    () =>
      (segmentsQuery.data ?? []).map((s) => ({
        id: String(s.id),
        name: s.name,
        memberCount: s.memberCount,
      })),
    [segmentsQuery.data]
  )

  function selectTier(tier: TierOption['id']) {
    if (disabled) return
    onChange({ ...value, view: tier })
  }

  const showSegmentError = value.view === 'segments' && value.segments.view.length === 0

  return (
    <div className="space-y-2.5">
      <span className="text-sm text-muted-foreground">Visibility</span>
      <div className="grid grid-cols-2 gap-2">
        {TIERS.map((tier) => {
          const Icon = tier.icon
          const active = value.view === tier.id
          return (
            <button
              key={tier.id}
              type="button"
              disabled={disabled}
              onClick={() => selectTier(tier.id)}
              className={cn(
                'flex items-start gap-2 rounded-md border px-2.5 py-2 text-left transition-colors',
                active
                  ? 'border-primary/40 bg-primary/5'
                  : 'border-border/50 bg-muted/20 hover:bg-muted/40',
                disabled && 'cursor-not-allowed opacity-60'
              )}
              aria-pressed={active}
            >
              <Icon
                className={cn(
                  'h-4 w-4 shrink-0 mt-0.5',
                  active ? 'text-primary' : 'text-muted-foreground'
                )}
              />
              <span className="flex flex-col">
                <span className="text-xs font-medium">{tier.label}</span>
                <span className="text-[10px] text-muted-foreground">{tier.blurb}</span>
              </span>
            </button>
          )
        })}
      </div>

      {value.view === 'segments' && (
        <div className="space-y-2">
          {segmentsQuery.isLoading ? (
            <div className="flex items-center gap-2 py-1.5 text-xs text-muted-foreground">
              <ArrowPathIcon className="h-3.5 w-3.5 animate-spin" />
              Loading segments…
            </div>
          ) : segments.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              No segments yet — create one in Settings → Segments first.
            </p>
          ) : (
            <SegmentMultiSelect
              segments={segments}
              value={value.segments.view}
              onChange={(next) => onChange({ ...value, segments: { view: next } })}
              disabled={disabled}
              ariaLabel="Changelog segment allowlist"
            />
          )}
          {showSegmentError && (
            <p className="text-xs text-destructive">
              Pick at least one segment — an empty allowlist hides the entry.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
