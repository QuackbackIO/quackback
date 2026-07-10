/** Small shared bits for the inspector's step editors: a labeled field
 *  wrapper, an id/name entity select, a clamped-int number input, and the
 *  amount+unit duration input, all lifted from the old popover editors
 *  verbatim (ClampedIntInput is new; see its own doc comment). */
import { useState } from 'react'
import { arrayMove } from '@dnd-kit/sortable'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  countSteps,
  isNeedsSetupRef,
  WAIT_UNITS,
  secondsToWaitParts,
  type TreeStep,
  type WaitUnit,
} from '../../workflow-graph'
import type { EntityOption } from '../entities'
import { ConfirmDeleteDialog } from '../step-visuals'

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  )
}

export function EntitySelect({
  value,
  placeholder,
  items,
  onChange,
}: {
  value: string
  placeholder: string
  items: EntityOption[]
  onChange: (id: string) => void
}) {
  // A template's needs-setup placeholder reads as "nothing chosen yet" so the
  // trigger shows the placeholder text instead of rendering blank.
  const selected = isNeedsSetupRef(value) ? '' : value
  return (
    <Select value={selected} onValueChange={onChange}>
      <SelectTrigger size="sm" className="w-full">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {items.map((item) => (
          <SelectItem key={item.id} value={item.id}>
            {item.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/**
 * A number input for a bounded integer that clamps on commit, not on every
 * keystroke. Clamping on keystroke fights the user two ways: clearing the
 * field snaps straight to the min (then typing "5" reads as "5" appended to
 * that min, e.g. "15"), and overshooting mid-type clamps to the max before
 * they finish typing the intended value. Instead, the field free-types while
 * focused (any raw string, including empty or out-of-range) and only clamps
 * to `[min, max]` on blur or Enter, at which point `onCommit` fires with the
 * clamped result and the field's display catches up to it.
 *
 * Shared by the trigger inspector's frequency-cap days/count inputs
 * (trigger-editor.tsx) and DurationInput below, which previously each wrote
 * their own near-identical clamp expression.
 */
export function ClampedIntInput({
  value,
  min,
  max,
  onCommit,
  className,
}: {
  value: number
  min: number
  max: number
  onCommit: (value: number) => void
  className?: string
}) {
  // null = not mid-edit; the field shows `value`. A non-null string is the
  // in-progress, not-yet-clamped keystroke state.
  const [draft, setDraft] = useState<string | null>(null)

  const commit = () => {
    if (draft === null) return
    const parsed = Math.round(Number(draft))
    const clamped = Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : min
    setDraft(null)
    if (clamped !== value) onCommit(clamped)
  }

  return (
    <Input
      type="number"
      min={min}
      max={max === Infinity ? undefined : max}
      value={draft ?? String(value)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
      }}
      className={className}
    />
  )
}

/**
 * Confirm-before-removing-a-path-with-steps: shared by every block editor
 * whose paths spawn their own step subtree the way a branch path does
 * (reply_buttons' button paths, request_csat's rating paths, and — since
 * branch-editor.tsx adopted this hook too — branch's own paths). A path with
 * no nested steps removes immediately (nothing to lose); one with steps opens
 * a confirm dialog naming the step count first. Keyed by the path's own
 * `key`, never an array index — an index drifts the moment the paths array
 * reorders or gains/loses an entry between the click and the confirm (the
 * editors had drifted onto index vs key independently before this was pulled
 * out). Generic over the path shape (`KeyedPath` has a `label`; branch's own
 * `BranchPath` doesn't) — `labelOf` picks what the confirm dialog names.
 */
export function usePathRemovalConfirm<T extends { key: string; steps: TreeStep[] }>(
  paths: T[],
  onRemove: (key: string) => void,
  labelOf: (path: T) => string
) {
  const [confirmKey, setConfirmKey] = useState<string | null>(null)
  const confirmPath = paths.find((p) => p.key === confirmKey) ?? null

  const requestRemove = (path: T) => {
    if (countSteps(path.steps) > 0) setConfirmKey(path.key)
    else onRemove(path.key)
  }

  const confirmDialog = (
    <ConfirmDeleteDialog
      open={confirmKey !== null}
      onOpenChange={(open) => !open && setConfirmKey(null)}
      title={confirmPath ? `Remove "${labelOf(confirmPath)}"?` : ''}
      description={
        confirmPath ? `Its ${countSteps(confirmPath.steps)} step(s) will be removed with it.` : ''
      }
      onConfirm={() => {
        if (confirmKey !== null) onRemove(confirmKey)
        setConfirmKey(null)
      }}
    />
  )

  return { requestRemove, confirmDialog }
}

/**
 * Swap a path with its adjacent neighbor (dir -1 = up, +1 = down) — shared by
 * branch-editor and reply-buttons-editor's up/down reorder buttons (both
 * reimplemented this by hand before being pulled out here). A thin wrapper
 * over @dnd-kit/sortable's `arrayMove` (already the drag-reorder primitive in
 * 4 other admin surfaces) rather than a hand-rolled index swap; no-ops past
 * either end, returning the SAME array reference so callers can cheaply check
 * `next === paths` to skip a no-op update.
 */
export function movePathAdjacent<T>(paths: T[], i: number, dir: -1 | 1): T[] {
  const j = i + dir
  if (j < 0 || j >= paths.length) return paths
  return arrayMove(paths, i, j)
}

/** The amount+unit duration input, shared by the wait step (wait-editor.tsx)
 *  and the snooze action's relative-duration mode (action-editor.tsx) so the
 *  two pick the same way. The amount field commits its clamp on blur/Enter
 *  via ClampedIntInput; the unit select still applies immediately (it isn't
 *  free-typed, so there's nothing to fight). */
export function DurationInput({
  seconds,
  onChange,
}: {
  seconds: number
  onChange: (seconds: number) => void
}) {
  const { amount, unit } = secondsToWaitParts(seconds)
  const unitSeconds = (u: WaitUnit) => WAIT_UNITS.find((w) => w.value === u)!.seconds

  return (
    <div className="flex items-center gap-1.5">
      <ClampedIntInput
        value={amount}
        min={0}
        max={Infinity}
        onCommit={(next) => onChange(next * unitSeconds(unit))}
        className="h-8 w-20 text-sm"
      />
      <Select value={unit} onValueChange={(u) => onChange(amount * unitSeconds(u as WaitUnit))}>
        <SelectTrigger size="sm" className="flex-1">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {WAIT_UNITS.map((u) => (
            <SelectItem key={u.value} value={u.value}>
              {u.plural}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
