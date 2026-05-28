import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react'
import { createPortal } from 'react-dom'
import { useForm } from 'react-hook-form'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  ChatBubbleLeftIcon,
  CheckIcon,
  ChevronDownIcon,
  EyeIcon,
  GlobeAltIcon,
  HandThumbUpIcon,
  InformationCircleIcon,
  LockClosedIcon,
  MagnifyingGlassIcon,
  PaperAirplaneIcon,
  PencilSquareIcon,
  PlusIcon,
  ShieldCheckIcon,
  TagIcon,
  UsersIcon,
} from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { FormError } from '@/components/shared/form-error'
import { useUpdateBoardAccess } from '@/lib/client/mutations'
import { useSegments } from '@/lib/client/hooks/use-segments-queries'
import { settingsQueries } from '@/lib/client/queries/settings'
import { cn } from '@/lib/shared/utils/cn'
import type { BoardId } from '@quackback/ids'
import {
  ACCESS_TIER_RANK,
  type AccessTier,
  type BoardAccess,
  DEFAULT_BOARD_ACCESS,
} from '@/lib/shared/db-types'
import { accessForPreset } from '@/lib/shared/schemas/boards'

/**
 * Per-board access form (R3 design).
 *
 * Standalone — Moderation now lives on its own settings page
 * (`board-moderation-form.tsx`). This form only edits the access slice
 * of `BoardAccess`; moderation is passed through unchanged on save.
 *
 * Behaviour:
 *   - Permanent 4 × 4 grid (action × tier). Presets are *derived* from
 *     the grid — editing any cell drops you into Custom; restoring all
 *     cells to a preset's tiers flips Custom back. No sticky preset.
 *   - The matrix is always visible — the preset row is a header
 *     summarising the current grid, not a mode switch.
 *   - Workspace `allowAnonymous` master switch acts as a per-cell
 *     ceiling: when off, the `anonymous` cell on vote/comment/submit is
 *     disabled (striped + globe icon) and an effect auto-bumps any cell
 *     currently on `anonymous` up to `authenticated`.
 *
 * The persisted shape is `BoardAccess` (see @/lib/shared/db-types).
 */

// ─── Static config ────────────────────────────────────────────────────

interface TierMeta {
  id: AccessTier
  label: string
  blurb: string
  icon: React.ComponentType<{ className?: string }>
}

// Tier icons use semantic muted token; the open→restrictive color ramp is
// shown once on the legend swatch only (a documented data-viz exception),
// so it stays out of the matrix cells where it would not theme correctly.
const TIERS: readonly TierMeta[] = [
  {
    id: 'anonymous',
    label: 'Anyone',
    blurb: 'Public · no sign-in',
    icon: GlobeAltIcon,
  },
  {
    id: 'authenticated',
    label: 'Signed-in',
    blurb: 'Any logged-in user',
    icon: UsersIcon,
  },
  {
    id: 'segments',
    label: 'Segments',
    blurb: 'Specific audiences',
    icon: TagIcon,
  },
  {
    id: 'team',
    label: 'Team only',
    blurb: 'Workspace members',
    icon: LockClosedIcon,
  },
] as const

interface ActionMeta {
  id: 'view' | 'vote' | 'comment' | 'submit'
  label: string
  sub: string
  icon: React.ComponentType<{ className?: string }>
}

const ACTIONS: readonly ActionMeta[] = [
  { id: 'view', label: 'View', sub: 'See posts and discussion', icon: EyeIcon },
  { id: 'vote', label: 'Vote', sub: 'Upvote posts to signal interest', icon: HandThumbUpIcon },
  { id: 'comment', label: 'Comment', sub: 'Reply on existing posts', icon: ChatBubbleLeftIcon },
  { id: 'submit', label: 'Submit posts', sub: 'Create new feedback', icon: PaperAirplaneIcon },
] as const

type ActionId = (typeof ACTIONS)[number]['id']
type PresetName = 'public' | 'private' | 'custom'

interface PresetMeta {
  id: Exclude<PresetName, 'custom'>
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  tiers: Record<ActionId, AccessTier>
}

// The tier mapping per preset is the SERVER source of truth
// (`accessForPreset`, shared by the create server-fn + optimistic insert).
// Picking the four tier fields off it here keeps the preset header in this
// form provably in sync with what create actually persists — a one-sided
// edit can no longer make a fresh Public board render as "Custom".
function tiersForPreset(id: Exclude<PresetName, 'custom'>): Record<ActionId, AccessTier> {
  const a = accessForPreset(id)
  return { view: a.view, vote: a.vote, comment: a.comment, submit: a.submit }
}

// Public — anyone can read; sign-in for any action.
// Private — internal/team boards, hidden from the portal.
export const PRESET_META: readonly PresetMeta[] = [
  {
    id: 'public',
    label: 'Public',
    description: 'Anyone can view. Sign-in is required to vote, comment, or submit.',
    icon: GlobeAltIcon,
    tiers: tiersForPreset('public'),
  },
  {
    id: 'private',
    label: 'Private',
    description: 'Only workspace members can access this board. Hidden from the portal.',
    icon: LockClosedIcon,
    tiers: tiersForPreset('private'),
  },
] as const

// ─── Workspace anonymous feature flag ─────────────────────────────────

/**
 * Workspace-wide anonymous-interaction ceiling. The legacy trio of
 * per-action toggles was consolidated into a single `features.allowAnonymous`
 * master switch — flipping it off blocks the `anonymous` tier on
 * vote/comment/submit together. View has no ceiling: "anyone can view a
 * public board" is the definition of public access.
 */
const ANON_CEILING_ACTIONS = ['vote', 'comment', 'submit'] as const
type AnonCeilingAction = (typeof ANON_CEILING_ACTIONS)[number]

// ─── Form shape ───────────────────────────────────────────────────────

interface Board {
  id: BoardId
  access: BoardAccess
}

interface BoardAccessFormProps {
  board: Board
}

type FormShape = BoardAccess

interface SegmentItem {
  id: string
  name: string
  count: number
  description?: string | null
}

/** Match the current grid against the preset table. Returns 'custom' when
 *  no preset matches — including any non-empty segment list, since presets
 *  always imply zero segments. */
function deriveActivePreset(values: FormShape): PresetName {
  const segmentsClean = ACTIONS.every((a) => (values.segments[a.id] ?? []).length === 0)
  if (!segmentsClean) return 'custom'
  for (const meta of PRESET_META) {
    if (ACTIONS.every((a) => values[a.id] === meta.tiers[a.id])) return meta.id
  }
  return 'custom'
}

// ─── Main form ────────────────────────────────────────────────────────

export function BoardAccessForm({ board }: BoardAccessFormProps) {
  const mutation = useUpdateBoardAccess()
  const segmentsQuery = useSegments()
  const segments: SegmentItem[] = useMemo(
    () =>
      (segmentsQuery.data ?? []).map((s) => ({
        id: s.id as string,
        name: s.name,
        count: s.memberCount,
        description: s.description,
      })),
    [segmentsQuery.data]
  )

  // Portal feature flags — workspace ceiling for anonymous access. The query
  // is non-suspense so the form keeps rendering when the cache is empty
  // (e.g. in tests). The default falls back to "allowed" so we don't
  // accidentally disable cells before we know better.
  const portalConfigQuery = useQuery({ ...settingsQueries.portalConfig(), retry: false })
  const wsAllowAnonymous: boolean = portalConfigQuery.data?.features?.allowAnonymous ?? true

  const form = useForm<FormShape>({
    defaultValues: board.access ?? DEFAULT_BOARD_ACCESS,
  })

  const [openPicker, setOpenPicker] = useState<ActionId | null>(null)

  // Sync form state when the server-side board.access changes (e.g. after a
  // successful save invalidates the boards query).
  const accessKey = JSON.stringify(board.access)
  useEffect(() => {
    const next = board.access ?? DEFAULT_BOARD_ACCESS
    form.reset(next)
    setOpenPicker(null)
  }, [accessKey, board.access, form])

  const values = form.watch()

  // Auto-bump: when the workspace `allowAnonymous` master switch flips
  // off, any of vote/comment/submit currently set to 'anonymous' gets
  // bumped to 'authenticated' together. The bumped form is dirty so the
  // user sees the save dock and can confirm or discard. We read the
  // current tier via `form.getValues()` so the effect doesn't have to
  // depend on `values` (which would re-fire on every keystroke / cell
  // click).
  useEffect(() => {
    if (wsAllowAnonymous) return
    ANON_CEILING_ACTIONS.forEach((id) => {
      if (form.getValues(id) === 'anonymous') {
        form.setValue(id, 'authenticated', { shouldDirty: true })
        form.setValue(`segments.${id}`, [], { shouldDirty: true })
      }
    })
  }, [wsAllowAnonymous, form])

  const activePreset = useMemo(() => deriveActivePreset(values), [values])

  // Validate: any action on the 'segments' tier needs ≥1 segment selected.
  const segsError = useMemo(
    () =>
      ACTIONS.some(
        (a) => values[a.id] === 'segments' && (values.segments[a.id] ?? []).length === 0
      ),
    [values]
  )

  // Actions whose anonymous tier is workspace-blocked. These are always the
  // same three — vote/comment/submit move together — but the banner still
  // renders the list explicitly so the copy stays unambiguous.
  const wsBlockedActions = useMemo(
    () =>
      wsAllowAnonymous
        ? []
        : ACTIONS.filter((a): a is ActionMeta =>
            ANON_CEILING_ACTIONS.includes(a.id as AnonCeilingAction)
          ),
    [wsAllowAnonymous]
  )

  const dirty = form.formState.isDirty

  const handlePresetClick = useCallback(
    (id: Exclude<PresetName, 'custom'>) => {
      const meta = PRESET_META.find((p) => p.id === id)
      if (!meta) return
      // Apply via setValue (not form.reset) so the change is tracked as
      // dirty and the save bar appears. reset() re-baselines defaultValues,
      // leaving isDirty false — which silently hides the save dock after a
      // preset click. moderation is left untouched (owned by the Moderation
      // sub-tab); presets target the access matrix only.
      const opts = { shouldDirty: true } as const
      form.setValue('view', meta.tiers.view, opts)
      form.setValue('vote', meta.tiers.vote, opts)
      form.setValue('comment', meta.tiers.comment, opts)
      form.setValue('submit', meta.tiers.submit, opts)
      // Presets always clear segment lists — they target non-segments tiers.
      form.setValue('segments', { view: [], vote: [], comment: [], submit: [] }, opts)
      setOpenPicker(null)
    },
    [form]
  )

  const handleTierClick = useCallback(
    (actionId: ActionId, tierId: AccessTier) => {
      // Tier hierarchy: comment/vote/submit can't be more open than view.
      if (actionId !== 'view' && ACCESS_TIER_RANK[tierId] < ACCESS_TIER_RANK[values.view]) {
        return
      }
      // Workspace ceiling: anonymous is gated by the workspace-wide
      // `allowAnonymous` master switch (view is always allowed,
      // vote/comment/submit move together).
      if (
        tierId === 'anonymous' &&
        !wsAllowAnonymous &&
        ANON_CEILING_ACTIONS.includes(actionId as AnonCeilingAction)
      ) {
        return
      }

      form.setValue(actionId, tierId, { shouldDirty: true })

      // Cascade: raising view tier may force comment/vote/submit up to
      // keep the invariant rank(other) >= rank(view). Clear the bumped
      // action's segment list too — a non-'segments' tier must not carry
      // a stale allowlist (matches the workspace auto-bump effect).
      if (actionId === 'view') {
        const vRank = ACCESS_TIER_RANK[tierId]
        ;(['vote', 'comment', 'submit'] as const).forEach((a) => {
          if (ACCESS_TIER_RANK[values[a]] < vRank) {
            form.setValue(a, tierId, { shouldDirty: true })
            if (tierId !== 'segments') {
              form.setValue(`segments.${a}`, [], { shouldDirty: true })
            }
          }
        })
      }

      // Picker hint: open the segments popover for the action that lands
      // on the segments tier with an empty list.
      if (tierId === 'segments') {
        if ((values.segments[actionId] ?? []).length === 0) {
          setOpenPicker(actionId)
        }
      } else if (openPicker === actionId) {
        setOpenPicker(null)
      }
    },
    [form, openPicker, values, wsAllowAnonymous]
  )

  const handleSegsChange = useCallback(
    (actionId: ActionId, ids: string[]) => {
      form.setValue(`segments.${actionId}`, ids, { shouldDirty: true })
    },
    [form]
  )

  const onSubmit = useCallback(
    (next: FormShape) => {
      if (segsError) return
      mutation.mutate({ boardId: board.id, access: next })
    },
    [board.id, mutation, segsError]
  )

  const handleDiscard = useCallback(() => {
    const original = board.access ?? DEFAULT_BOARD_ACCESS
    form.reset(original)
    setOpenPicker(null)
  }, [board.access, form])

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 pb-24">
      {mutation.isError && <FormError message={mutation.error?.message ?? 'An error occurred'} />}

      <div className="space-y-4">
        <p className="text-xs text-muted-foreground max-w-xl">
          Pick a preset, or tweak any cell to fine-tune. Custom is set automatically when your
          configuration doesn&apos;t match a preset.
        </p>

        <PresetGrid active={activePreset} onSelect={handlePresetClick} />
      </div>

      <div className="space-y-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-semibold">Per-action permissions</span>
          <span className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
            {/* Legend swatch: the open→restrictive color ramp is a deliberate
                data-viz signal and is the sole sanctioned literal-color use
                in this form (it never appears in the themed matrix cells). */}
            <span
              className="inline-block h-1 w-5 rounded-sm"
              style={{
                background:
                  'linear-gradient(to right, rgb(74 222 128), rgb(250 204 21), rgb(248 113 113))',
              }}
            />
            More open <span className="opacity-60">→</span> More restrictive
          </span>
        </div>

        <Matrix
          values={values}
          wsAllowAnonymous={wsAllowAnonymous}
          segments={segments}
          segmentsLoading={segmentsQuery.isLoading}
          openPicker={openPicker}
          onCellClick={handleTierClick}
          onOpenPicker={(id) => setOpenPicker((p) => (p === id ? null : id))}
          onClosePicker={() => setOpenPicker(null)}
          onSegsChange={handleSegsChange}
        />

        {!wsAllowAnonymous && (
          <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
            <GlobeAltIcon className="h-3 w-3 shrink-0" />
            <span>
              Workspace policy disables the <span className="text-foreground">Anyone</span> tier
              for:{' '}
              <span className="text-foreground">
                {wsBlockedActions.map((a) => a.label).join(', ')}
              </span>
              .
            </span>
            <Link
              to="/admin/settings/moderation"
              className="ml-auto whitespace-nowrap text-primary hover:underline"
            >
              Workspace access →
            </Link>
          </div>
        )}
      </div>

      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldCheckIcon className="h-3 w-3" />
        Team members and admins always have full access — they bypass these rules.
      </p>

      <SaveDock
        dirty={dirty}
        error={segsError}
        saving={mutation.isPending}
        onDiscard={handleDiscard}
      />
    </form>
  )
}

// ─── Preset cards row ────────────────────────────────────────────────

interface PresetGridProps {
  active: PresetName
  onSelect: (id: Exclude<PresetName, 'custom'>) => void
}

function PresetGrid({ active, onSelect }: PresetGridProps) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {PRESET_META.map((p) => (
        <PresetCard
          key={p.id}
          active={active === p.id}
          label={p.label}
          description={p.description}
          icon={<p.icon className="h-3 w-3" />}
          onClick={() => onSelect(p.id)}
        />
      ))}
      {/* Custom is derived — not interactive. Lights up when no preset matches. */}
      <CustomStatusCard active={active === 'custom'} />
    </div>
  )
}

interface PresetCardProps {
  active: boolean
  label: string
  description: string
  icon: React.ReactNode
  onClick: () => void
}

function PresetCard({ active, label, description, icon, onClick }: PresetCardProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        'flex flex-col items-stretch gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors',
        active
          ? 'border-primary bg-primary/10'
          : 'border-border bg-muted/30 hover:bg-muted/60 cursor-pointer'
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className={active ? 'text-primary' : 'text-muted-foreground'}>{icon}</span>
        <span className={cn('text-xs font-semibold', active && 'text-primary')}>{label}</span>
        {active && <CheckIcon className="ml-auto h-3 w-3 text-primary" />}
      </div>
      <span className="text-xs leading-snug text-muted-foreground">{description}</span>
    </button>
  )
}

interface CustomStatusCardProps {
  active: boolean
}

function CustomStatusCard({ active }: CustomStatusCardProps) {
  return (
    <div
      role="status"
      aria-label="Custom"
      aria-pressed={active}
      title="Tweak any cell below to enter Custom."
      className={cn(
        'flex cursor-default flex-col items-stretch gap-1 rounded-lg border border-dashed px-3 py-2.5 text-left transition-colors',
        active ? 'border-primary bg-primary/10' : 'border-border bg-transparent opacity-60'
      )}
    >
      <div className="flex items-center gap-1.5">
        <span className={active ? 'text-primary' : 'text-muted-foreground'}>
          <PencilSquareIcon className="h-3 w-3" />
        </span>
        <span className={cn('text-xs font-semibold', active && 'text-primary')}>Custom</span>
        {active && <CheckIcon className="ml-auto h-3 w-3 text-primary" />}
      </div>
      <span className="text-xs leading-snug text-muted-foreground">
        Set when any cell deviates from a preset.
      </span>
    </div>
  )
}

// ─── Matrix ──────────────────────────────────────────────────────────

interface MatrixProps {
  values: FormShape
  wsAllowAnonymous: boolean
  segments: ReadonlyArray<SegmentItem>
  segmentsLoading: boolean
  openPicker: ActionId | null
  onCellClick: (actionId: ActionId, tierId: AccessTier) => void
  onOpenPicker: (id: ActionId) => void
  onClosePicker: () => void
  onSegsChange: (actionId: ActionId, ids: string[]) => void
}

function Matrix({
  values,
  wsAllowAnonymous,
  segments,
  segmentsLoading,
  openPicker,
  onCellClick,
  onOpenPicker,
  onClosePicker,
  onSegsChange,
}: MatrixProps) {
  return (
    // Mobile: the fixed 5-col grid can't crush below ~560px, so let it scroll
    // horizontally instead. The negative margin lets the scroll area bleed to
    // the card edge on phones; it resets at sm where the column has room.
    <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
      <div
        className="min-w-[560px] overflow-hidden rounded-lg border bg-muted/20"
        role="grid"
        aria-label="Permissions matrix"
      >
        <div
          className="grid min-w-[560px] bg-muted/40 border-b text-xs uppercase tracking-wider text-muted-foreground"
          style={{ gridTemplateColumns: '1.5fr repeat(4, 1fr)' }}
        >
          <div className="px-4 py-2.5 font-medium">Action</div>
          {TIERS.map((t) => (
            <div
              key={t.id}
              className="flex flex-col items-center justify-center gap-0.5 border-l py-2 text-center normal-case"
            >
              <div className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <span className="text-muted-foreground">
                  <t.icon className="h-3 w-3" />
                </span>
                {t.label}
              </div>
              <div className="text-xs text-muted-foreground tracking-normal">{t.blurb}</div>
            </div>
          ))}
        </div>

        {ACTIONS.map((action, idx) => (
          <MatrixRow
            key={action.id}
            action={action}
            values={values}
            wsAllowAnonymous={wsAllowAnonymous}
            isLast={idx === ACTIONS.length - 1}
            segments={segments}
            segmentsLoading={segmentsLoading}
            pickerOpen={openPicker === action.id}
            onCellClick={(tier) => onCellClick(action.id, tier)}
            onOpenPicker={() => onOpenPicker(action.id)}
            onClosePicker={onClosePicker}
            onSegsChange={(ids) => onSegsChange(action.id, ids)}
          />
        ))}
      </div>
    </div>
  )
}

interface MatrixRowProps {
  action: ActionMeta
  values: FormShape
  wsAllowAnonymous: boolean
  isLast: boolean
  segments: MatrixProps['segments']
  segmentsLoading: boolean
  pickerOpen: boolean
  onCellClick: (tier: AccessTier) => void
  onOpenPicker: () => void
  onClosePicker: () => void
  onSegsChange: (ids: string[]) => void
}

function MatrixRow({
  action,
  values,
  wsAllowAnonymous,
  isLast,
  segments,
  segmentsLoading,
  pickerOpen,
  onCellClick,
  onOpenPicker,
  onClosePicker,
  onSegsChange,
}: MatrixRowProps) {
  const segCellRef = useRef<HTMLButtonElement | null>(null)
  const selectedTier = values[action.id]
  const segIds = values.segments[action.id]
  const reach = useMemo(
    () => segments.filter((s) => segIds.includes(s.id)).reduce((a, s) => a + s.count, 0),
    [segments, segIds]
  )
  const isEmptySegments = selectedTier === 'segments' && segIds.length === 0
  const minRank = action.id === 'view' ? 0 : ACCESS_TIER_RANK[values.view]

  return (
    <div
      className={cn('relative grid min-w-[560px] border-b', isLast && 'border-b-0')}
      style={{ gridTemplateColumns: '1.5fr repeat(4, 1fr)' }}
      role="row"
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-muted/40 text-muted-foreground">
          <action.icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-medium">{action.label}</div>
          <div className="text-xs text-muted-foreground">{action.sub}</div>
        </div>
      </div>

      {TIERS.map((tier) => {
        const isSelected = selectedTier === tier.id
        const hierarchyBlocked = ACCESS_TIER_RANK[tier.id] < minRank
        // Workspace ceiling: vote/comment/submit's `anonymous` cell moves
        // as a single unit, gated by the workspace allowAnonymous switch.
        // View has no ceiling.
        const isAnonCeilingAction = ANON_CEILING_ACTIONS.includes(action.id as AnonCeilingAction)
        const wsBlocked = tier.id === 'anonymous' && isAnonCeilingAction && !wsAllowAnonymous
        const disabled = hierarchyBlocked || wsBlocked
        const isSegmentsCell = tier.id === 'segments'

        const tooltip = wsBlocked
          ? 'Anonymous interaction is disabled workspace-wide. Manage in Workspace → Access.'
          : hierarchyBlocked
            ? `Can't be more open than View (${TIERS.find((x) => ACCESS_TIER_RANK[x.id] === minRank)?.label}).`
            : undefined

        const disabledStyle: CSSProperties = disabled
          ? {
              background:
                'repeating-linear-gradient(135deg, transparent 0 6px, rgba(255,255,255,0.02) 6px 7px)',
            }
          : {}

        const BlockIcon = wsBlocked ? GlobeAltIcon : LockClosedIcon

        return (
          <button
            key={tier.id}
            type="button"
            ref={isSegmentsCell ? segCellRef : null}
            title={tooltip}
            onClick={() => {
              if (disabled) return
              if (isSegmentsCell && isSelected) {
                onOpenPicker()
              } else {
                onCellClick(tier.id)
              }
            }}
            disabled={disabled}
            aria-label={`${action.label}: ${tier.label}`}
            aria-pressed={isSelected}
            data-disabled-reason={
              wsBlocked ? 'workspace' : hierarchyBlocked ? 'hierarchy' : undefined
            }
            className={cn(
              'flex min-h-[58px] items-center justify-center border-l px-2 py-3 transition-colors',
              !disabled && 'cursor-pointer',
              disabled && 'cursor-not-allowed opacity-40',
              !disabled && isSelected && !isEmptySegments && 'bg-primary/10',
              !disabled && isSelected && isEmptySegments && 'bg-destructive/10',
              !disabled && !isSelected && 'hover:bg-muted/40'
            )}
            style={disabledStyle}
          >
            {isSegmentsCell && isSelected && !disabled ? (
              <SegmentCellPreview
                empty={isEmptySegments}
                selected={segments.filter((s) => segIds.includes(s.id))}
                reach={reach}
              />
            ) : (
              <span
                className={cn(
                  'inline-flex h-4 w-4 items-center justify-center rounded-full border-2',
                  isSelected && !disabled
                    ? 'border-primary bg-transparent'
                    : 'border-border bg-background'
                )}
              >
                {isSelected && !disabled && (
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                )}
                {disabled && <BlockIcon className="h-2.5 w-2.5 text-muted-foreground" />}
              </span>
            )}
          </button>
        )
      })}

      {pickerOpen && (
        <SegmentPicker
          anchorRef={segCellRef}
          allSegments={segments}
          loading={segmentsLoading}
          selected={segIds}
          onChange={onSegsChange}
          onClose={onClosePicker}
        />
      )}
    </div>
  )
}

// ─── In-cell preview when a row picks 'segments' ─────────────────────

interface SegmentCellPreviewProps {
  empty: boolean
  selected: ReadonlyArray<{ id: string; name: string }>
  reach: number
}

function SegmentCellPreview({ empty, selected, reach }: SegmentCellPreviewProps) {
  if (empty) {
    return (
      <span className="flex flex-col items-center gap-0.5 text-xs font-medium text-destructive">
        <InformationCircleIcon className="h-3 w-3" />
        Pick segments
      </span>
    )
  }
  const first = selected[0]
  const extra = selected.length - 1
  return (
    <span className="flex w-full min-w-0 flex-col items-center gap-0.5 px-1 text-center">
      <span className="flex w-full min-w-0 items-center justify-center gap-1">
        <span className="min-w-0 truncate text-sm font-medium text-primary">{first?.name}</span>
        {extra > 0 && (
          <span className="shrink-0 rounded border border-primary/30 bg-primary/10 px-1 text-xs font-semibold leading-4 text-primary">
            +{extra}
          </span>
        )}
        <ChevronDownIcon className="h-2.5 w-2.5 shrink-0 text-primary/70" />
      </span>
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <UsersIcon className="h-2.5 w-2.5" />
        <span className="font-mono tabular-nums">≈ {reach}</span>
      </span>
    </span>
  )
}

// ─── Inline popover combobox ─────────────────────────────────────────

interface SegmentPickerProps {
  anchorRef: React.RefObject<HTMLElement | null>
  allSegments: MatrixProps['segments']
  loading: boolean
  selected: readonly string[]
  onChange: (ids: string[]) => void
  onClose: () => void
}

function SegmentPicker({
  anchorRef,
  allSegments,
  loading,
  selected,
  onChange,
  onClose,
}: SegmentPickerProps) {
  const [search, setSearch] = useState('')
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null)
  const popRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useLayoutEffect(() => {
    if (!anchorRef.current) return
    const r = anchorRef.current.getBoundingClientRect()
    // Clamp the popover so it never exceeds the viewport on a narrow phone.
    const width = Math.min(320, window.innerWidth - 16)
    setPos({ top: r.bottom + 4, left: Math.max(8, r.right - width), width })
  }, [anchorRef])

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node
      if (popRef.current?.contains(target)) return
      if (anchorRef.current?.contains(target)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [anchorRef, onClose])

  if (!pos) return null

  const q = search.trim().toLowerCase()
  const filtered = q ? allSegments.filter((s) => s.name.toLowerCase().includes(q)) : allSegments
  const totalReach = allSegments
    .filter((s) => selected.includes(s.id))
    .reduce((a, s) => a + s.count, 0)

  const toggle = (id: string) => {
    if (selected.includes(id)) onChange(selected.filter((x) => x !== id))
    else onChange([...selected, id])
  }

  return createPortal(
    <div
      ref={popRef}
      role="dialog"
      aria-label="Pick segments"
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        width: pos.width,
        maxWidth: 'calc(100vw - 16px)',
        zIndex: 200,
      }}
      className="overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-xl"
    >
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <MagnifyingGlassIcon className="h-3 w-3 text-muted-foreground" />
        <input
          ref={inputRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search or create…"
          aria-label="Search segments"
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
        />
        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>

      <div className="max-h-[280px] overflow-y-auto p-1">
        {loading && (
          <div className="px-3 py-4 text-xs text-muted-foreground">Loading segments…</div>
        )}
        {!loading &&
          filtered.map((s) => {
            const on = selected.includes(s.id)
            return (
              <button
                key={s.id}
                type="button"
                onClick={() => toggle(s.id)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors',
                  on ? 'bg-muted/60' : 'hover:bg-muted/40'
                )}
              >
                <Checkbox checked={on} aria-hidden tabIndex={-1} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{s.name}</div>
                  {s.description && (
                    <div className="truncate text-xs text-muted-foreground">{s.description}</div>
                  )}
                </div>
                <span className="inline-flex items-center gap-1 font-mono text-xs tabular-nums text-muted-foreground">
                  <UsersIcon className="h-2.5 w-2.5" />
                  {s.count}
                </span>
              </button>
            )
          })}
        {!loading && filtered.length === 0 && (
          <Link
            to="/admin/settings/people"
            className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-3 text-xs text-foreground hover:bg-muted"
          >
            <PlusIcon className="h-3 w-3" />
            <span>
              Create segment{' '}
              <span className="font-medium text-primary">&quot;{search || 'new'}&quot;</span>
            </span>
          </Link>
        )}
      </div>

      <div className="flex items-center justify-between border-t bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <UsersIcon className="h-2.5 w-2.5" />
          <span>Reach:</span>
          <span className="font-mono font-medium text-foreground">≈ {totalReach}</span>
          <span className="opacity-50">·</span>
          <span>
            {selected.length}/{allSegments.length} selected
          </span>
        </span>
        <Link to="/admin/settings/people" className="text-primary hover:underline">
          Manage →
        </Link>
      </div>
    </div>,
    document.body
  )
}

// ─── Sticky save dock ────────────────────────────────────────────────

interface SaveDockProps {
  dirty: boolean
  error: boolean
  saving: boolean
  onDiscard: () => void
}

function SaveDock({ dirty, error, saving, onDiscard }: SaveDockProps) {
  return (
    <div
      role="region"
      aria-label="Save changes"
      data-dirty={dirty || undefined}
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 border-t bg-background/85 backdrop-blur-sm transition-transform duration-200',
        dirty ? 'translate-y-0' : 'pointer-events-none translate-y-full'
      )}
    >
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span
            className={cn(
              'inline-block h-2 w-2 rounded-full',
              error ? 'bg-destructive' : 'bg-primary'
            )}
            style={
              error
                ? { boxShadow: '0 0 8px rgba(248, 113, 113, 0.6)' }
                : { boxShadow: '0 0 8px rgba(250, 204, 21, 0.6)' }
            }
          />
          {error
            ? 'Some rules use Segments but no segments are selected.'
            : 'You have unsaved changes.'}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onDiscard} disabled={saving}>
            Discard
          </Button>
          <Button type="submit" size="sm" disabled={error || saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </div>
    </div>
  )
}
