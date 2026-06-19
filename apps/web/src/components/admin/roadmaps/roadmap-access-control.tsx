import { useMemo } from 'react'
import {
  GlobeAltIcon,
  UsersIcon,
  TagIcon,
  LockClosedIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/solid'
import { cn } from '@/lib/shared/utils'
import { Label } from '@/components/ui/label'
import { useSegments } from '@/lib/client/hooks/use-segments-queries'
import { SegmentMultiSelect } from '@/components/admin/segments/segment-multi-select'
import type { AccessTier, RoadmapAccess } from '@/lib/shared/db-types'

interface TierMeta {
  id: AccessTier
  label: string
  blurb: string
  icon: React.ComponentType<{ className?: string }>
}

// Mirrors the board access tiers (view-only). Labels/icons match
// board-access-form.tsx so the two surfaces read consistently.
const TIERS: readonly TierMeta[] = [
  { id: 'anonymous', label: 'Public', blurb: 'Anyone · no sign-in', icon: GlobeAltIcon },
  { id: 'authenticated', label: 'Signed-in', blurb: 'Any logged-in user', icon: UsersIcon },
  { id: 'segments', label: 'Segments', blurb: 'Specific audiences', icon: TagIcon },
  { id: 'team', label: 'Private', blurb: 'Workspace members', icon: LockClosedIcon },
] as const

interface RoadmapAccessControlProps {
  value: RoadmapAccess
  onChange: (next: RoadmapAccess) => void
  disabled?: boolean
}

/**
 * Controlled visibility editor for a roadmap — the view-only counterpart of
 * the board access form. Picks a tier (Public / Signed-in / Segments /
 * Private); when "Segments" is selected, reveals a segment allowlist.
 */
export function RoadmapAccessControl({ value, onChange, disabled }: RoadmapAccessControlProps) {
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

  function selectTier(tier: AccessTier) {
    if (disabled) return
    onChange({ ...value, view: tier })
  }

  function setSegments(next: string[]) {
    onChange({ ...value, segments: { view: next } })
  }

  const showSegmentError = value.view === 'segments' && value.segments.view.length === 0

  return (
    <div className="space-y-3">
      <Label>Visibility</Label>
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
                'flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-left transition-colors',
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
                <span className="text-sm font-medium">{tier.label}</span>
                <span className="text-xs text-muted-foreground">{tier.blurb}</span>
              </span>
            </button>
          )
        })}
      </div>

      {value.view === 'segments' && (
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Allowed segments</Label>
          {segmentsQuery.isLoading ? (
            <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
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
              onChange={setSegments}
              disabled={disabled}
              ariaLabel="Roadmap segment allowlist"
            />
          )}
          {showSegmentError && (
            <p className="text-xs text-destructive">
              Pick at least one segment — an empty allowlist hides the roadmap.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
