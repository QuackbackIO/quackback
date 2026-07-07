'use client'

import { useState } from 'react'
import {
  PlusIcon,
  UsersIcon,
  UserPlusIcon,
  PencilIcon,
  TrashIcon,
  BoltIcon,
  ArrowPathIcon,
  EnvelopeIcon,
  GlobeAltIcon,
  BuildingOffice2Icon,
} from '@heroicons/react/24/solid'
import { Link, useNavigate } from '@tanstack/react-router'
import { FilterSection } from '@/components/shared/filter-section'
import { cn } from '@/lib/shared/utils'
import type { SegmentListItem } from '@/lib/client/hooks/use-segments-queries'

interface UsersSegmentNavProps {
  segments: SegmentListItem[] | undefined
  isLoading: boolean
  selectedSegmentIds: string[]
  onSelectSegment: (segmentId: string, shiftKey: boolean) => void
  onClearSegments: () => void
  totalUserCount: number
  onCreateSegment: () => void
  onEditSegment: (segment: SegmentListItem) => void
  onDeleteSegment: (segment: SegmentListItem) => void
  onEvaluateSegment?: (segmentId: string) => void
  isEvaluating?: string | null
  /**
   * `?invites=<status>` is set, so the Invitations entry should render
   * active and All-users should not.
   */
  inInvitesMode?: boolean
  /** Pending-invite count for the Invitations entry badge. */
  invitesPendingCount?: number
  /** `?lifecycle=leads` is set: the All-leads entry renders active. */
  inLeadsMode?: boolean
  /** Lead count for the All-leads entry badge. */
  totalLeadCount?: number
  /** `?lifecycle=companies` is set: the Companies entry renders active. */
  inCompaniesMode?: boolean
  /** Company count for the Companies entry badge. */
  totalCompanyCount?: number
  /** 30d unique visitors (top of funnel); null hides the line. */
  visitorCount?: number | null
}

export function UsersSegmentNav({
  segments,
  isLoading,
  selectedSegmentIds,
  onSelectSegment,
  // `onClearSegments` is part of the public prop shape (the mobile
  // selector below + downstream callers still pass it), but the
  // 'All users' click handler now uses a single navigate that strips
  // both `invites` and `segments` at once — see the comment on that
  // button. Calling onClearSegments here would re-introduce the race.
  onClearSegments: _onClearSegments,
  totalUserCount,
  onCreateSegment,
  onEditSegment,
  onDeleteSegment,
  onEvaluateSegment,
  isEvaluating,
  inInvitesMode,
  invitesPendingCount,
  inLeadsMode,
  totalLeadCount,
  inCompaniesMode,
  totalCompanyCount,
  visitorCount,
}: UsersSegmentNavProps) {
  const hasSelection = selectedSegmentIds.length > 0
  const navigate = useNavigate()

  return (
    <div className="space-y-0">
      <div className="pb-4">
        {/* Views group — top-level navigation between the main user list
            and the standalone Invitations view. No header here: at one
            indent level the items read as the sidebar's primary entries
            and the SEGMENTS subheader below provides the grouping cue. */}
        <div className="space-y-1">
          {/* All users — clearing both segment selection and invites mode
              brings the user back here. Both can be active at once
              (e.g. `?segments=abc&invites=pending`), so we strip both
              in a SINGLE navigate — splitting it across two updates
              (one for invites, then `onClearSegments` for segments)
              races: the second navigate re-includes the key the first
              one just cleared because it reads search state from a
              snapshot taken before the first navigate settled. */}
          <button
            type="button"
            onClick={() => {
              if (!inInvitesMode && !hasSelection && !inLeadsMode && !inCompaniesMode) return
              void navigate({
                from: '/admin/users',
                search: (prev) => ({
                  ...prev,
                  invites: undefined,
                  segments: undefined,
                  lifecycle: undefined,
                  company: undefined,
                }),
                replace: true,
              })
            }}
            className={cn(
              'w-full text-left px-2.5 py-1.5 rounded-md text-[13px] font-normal transition-colors flex items-center gap-2',
              !hasSelection && !inInvitesMode && !inLeadsMode && !inCompaniesMode
                ? 'bg-muted text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            )}
          >
            <UsersIcon className="size-4 shrink-0" />
            <span className="flex-1 truncate">All users</span>
            <span className="text-xs text-muted-foreground/60 shrink-0 tabular-nums">
              {totalUserCount}
            </span>
          </button>

          {/* All leads — engaged-but-unauthenticated people (anonymous
              principals). A lifecycle view, not a filter: it swaps the list's
              population, so segments and invites mode are cleared with it. */}
          <button
            type="button"
            onClick={() => {
              if (inLeadsMode) return
              void navigate({
                from: '/admin/users',
                search: (prev) => ({
                  ...prev,
                  invites: undefined,
                  segments: undefined,
                  lifecycle: 'leads' as const,
                  company: undefined,
                }),
                replace: true,
              })
            }}
            className={cn(
              'w-full text-left px-2.5 py-1.5 rounded-md text-[13px] font-normal transition-colors flex items-center gap-2',
              inLeadsMode
                ? 'bg-muted text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            )}
          >
            <UserPlusIcon className="size-4 shrink-0" />
            <span className="flex-1 truncate">All leads</span>
            {totalLeadCount !== undefined && (
              <span className="text-xs text-muted-foreground/60 shrink-0 tabular-nums">
                {totalLeadCount}
              </span>
            )}
          </button>

          {/* All companies — the directory tab over the B2B company object.
              A lifecycle view like leads: it swaps the pane's population, so
              segments and invites mode are cleared with it. */}
          <button
            type="button"
            onClick={() => {
              if (inCompaniesMode) return
              void navigate({
                from: '/admin/users',
                search: (prev) => ({
                  ...prev,
                  invites: undefined,
                  segments: undefined,
                  lifecycle: 'companies' as const,
                  company: undefined,
                }),
                replace: true,
              })
            }}
            className={cn(
              'w-full text-left px-2.5 py-1.5 rounded-md text-[13px] font-normal transition-colors flex items-center gap-2',
              inCompaniesMode
                ? 'bg-muted text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            )}
          >
            <BuildingOffice2Icon className="size-4 shrink-0" />
            <span className="flex-1 truncate">All companies</span>
            {totalCompanyCount !== undefined && (
              <span className="text-xs text-muted-foreground/60 shrink-0 tabular-nums">
                {totalCompanyCount}
              </span>
            )}
          </button>

          {/* Visitors — top of the funnel. Not directory rows (a visitor has
              no principal until they engage), so this deep-links to the
              analytics Visitors section instead of filtering the list. */}
          {visitorCount != null && (
            <Link
              to="/admin/analytics"
              className="w-full text-left px-2.5 py-1.5 rounded-md text-[13px] font-normal transition-colors flex items-center gap-2 text-muted-foreground hover:text-foreground hover:bg-muted/50"
            >
              <GlobeAltIcon className="size-4 shrink-0" />
              <span className="flex-1 truncate">Visitors (30d)</span>
              <span className="text-xs text-muted-foreground/60 shrink-0 tabular-nums">
                {visitorCount.toLocaleString()}
              </span>
            </Link>
          )}

          {/* Invitations — sibling of All users. Clicking enters invites
              mode with the pending status by default; the InvitationsView
              itself lets admins flip between status sub-tabs. */}
          <Link
            to="/admin/users"
            from="/admin/users"
            search={(prev) => ({ ...prev, invites: 'pending' as const })}
            replace
            className={cn(
              'w-full text-left px-2.5 py-1.5 rounded-md text-[13px] font-normal transition-colors flex items-center gap-2',
              inInvitesMode
                ? 'bg-muted text-foreground font-medium'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            )}
          >
            <EnvelopeIcon className="size-4 shrink-0" />
            <span className="flex-1 truncate">Invitations</span>
            {invitesPendingCount !== undefined && invitesPendingCount > 0 && (
              <span className="text-xs text-muted-foreground/60 shrink-0 tabular-nums">
                {invitesPendingCount}
              </span>
            )}
          </Link>
        </div>

        {/* Segments group — its own labelled section via the shared
            FilterSection. The +-button lives in the header's action slot
            where it belongs (the previous placement under USERS implied
            'create user'). */}
        <div className="mt-5">
          <FilterSection
            title="Segments"
            collapsible={false}
            action={
              <button
                type="button"
                onClick={onCreateSegment}
                title="Create segment"
                className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              >
                <PlusIcon className="h-3 w-3" />
              </button>
            }
          >
            {isLoading ? (
              <div className="space-y-1">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-7 bg-muted/30 rounded-md animate-pulse" />
                ))}
              </div>
            ) : !segments || segments.length === 0 ? (
              <p className="text-xs text-muted-foreground px-2.5 py-1.5">
                No segments yet. Click + to create one.
              </p>
            ) : (
              <div className="space-y-0.5">
                {segments.map((seg) => (
                  <SegmentNavItem
                    key={seg.id}
                    segment={seg}
                    isSelected={selectedSegmentIds.includes(seg.id)}
                    onSelect={(shiftKey) => onSelectSegment(seg.id, shiftKey)}
                    onEdit={() => onEditSegment(seg)}
                    onDelete={() => onDeleteSegment(seg)}
                    onEvaluate={
                      seg.type === 'dynamic' && onEvaluateSegment
                        ? () => onEvaluateSegment(seg.id)
                        : undefined
                    }
                    isEvaluating={isEvaluating === seg.id}
                  />
                ))}
              </div>
            )}
          </FilterSection>
        </div>
      </div>
    </div>
  )
}

function SegmentNavItem({
  segment,
  isSelected,
  onSelect,
  onEdit,
  onDelete,
  onEvaluate,
  isEvaluating,
}: {
  segment: SegmentListItem
  isSelected: boolean
  onSelect: (shiftKey: boolean) => void
  onEdit: () => void
  onDelete: () => void
  onEvaluate?: () => void
  isEvaluating: boolean
}) {
  return (
    <div
      className={cn(
        'group flex items-center rounded-md transition-colors',
        isSelected ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50'
      )}
    >
      <button
        type="button"
        onClick={(e) => onSelect(e.shiftKey)}
        className={cn(
          'flex-1 min-w-0 flex items-center gap-2 px-2.5 py-1.5 text-[13px] text-left',
          isSelected ? 'font-medium' : 'font-normal'
        )}
      >
        <span className="flex-1 truncate">{segment.name}</span>
        {segment.type === 'dynamic' && (
          <BoltIcon className="h-2.5 w-2.5 shrink-0 opacity-50" title="Dynamic segment" />
        )}
        <span className="group-hover:hidden text-xs text-muted-foreground/60 shrink-0 tabular-nums">
          {segment.memberCount}
        </span>
      </button>

      {/* Hover actions */}
      <div className="hidden group-hover:flex items-center shrink-0 pr-1">
        {onEvaluate && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onEvaluate()
            }}
            disabled={isEvaluating}
            className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
            title="Re-evaluate"
          >
            <ArrowPathIcon className={cn('h-3 w-3', isEvaluating && 'animate-spin')} />
          </button>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onEdit()
          }}
          className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
          title="Edit segment"
        >
          <PencilIcon className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="p-1 rounded text-muted-foreground hover:text-destructive transition-colors"
          title="Delete segment"
        >
          <TrashIcon className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}

/**
 * Mobile segment selector - rendered as a compact multi-select dropdown
 */
export function MobileSegmentSelector({
  segments,
  selectedSegmentIds,
  onSelectSegment,
  onClearSegments,
}: {
  segments: SegmentListItem[] | undefined
  selectedSegmentIds: string[]
  onSelectSegment: (segmentId: string, shiftKey: boolean) => void
  onClearSegments: () => void
}) {
  const [open, setOpen] = useState(false)

  if (!segments || segments.length === 0) return null

  const selectedNames = segments.filter((s) => selectedSegmentIds.includes(s.id)).map((s) => s.name)

  const label =
    selectedNames.length === 0
      ? 'All users'
      : selectedNames.length === 1
        ? selectedNames[0]
        : `${selectedNames.length} segments`

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className={cn(
          'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium',
          'border border-border/50 bg-card',
          'hover:bg-muted/50 transition-colors'
        )}
      >
        <UsersIcon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="truncate max-w-[160px]">{label}</span>
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full left-0 mt-1 z-50 w-56 rounded-lg border border-border bg-popover shadow-md py-1">
            <button
              type="button"
              onClick={() => {
                onClearSegments()
                setOpen(false)
              }}
              className={cn(
                'w-full text-left px-3 py-1.5 text-xs font-medium',
                'hover:bg-muted/50 transition-colors',
                selectedSegmentIds.length === 0 && 'bg-muted text-foreground'
              )}
            >
              All users
            </button>
            <div className="border-b border-border/30 my-1" />
            {segments.map((seg) => (
              <button
                key={seg.id}
                type="button"
                onClick={() => onSelectSegment(seg.id, true)}
                className={cn(
                  'w-full text-left px-3 py-1.5 text-xs flex items-center gap-2',
                  'hover:bg-muted/50 transition-colors',
                  selectedSegmentIds.includes(seg.id) && 'bg-muted text-foreground font-medium'
                )}
              >
                <span className="flex-1 truncate">{seg.name}</span>
                {seg.type === 'dynamic' && <BoltIcon className="h-2.5 w-2.5 opacity-50" />}
                <span className="text-xs text-muted-foreground/60 tabular-nums">
                  {seg.memberCount}
                </span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
