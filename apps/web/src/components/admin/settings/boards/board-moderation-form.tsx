import { useCallback, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { Link } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { Badge } from '@/components/ui/badge'
import { SegmentedControl } from '@/components/shared/segmented-control'
import { SettingRow, SettingRows } from '@/components/admin/settings/setting-row'
import { useDebouncedSave } from '@/lib/client/hooks/use-debounced-save'
import { useUpdateBoardAccess } from '@/lib/client/mutations'
import { settingsQueries } from '@/lib/client/queries/settings'
import type { BoardId } from '@quackback/ids'
import {
  type BoardAccess,
  DEFAULT_BOARD_ACCESS,
  type ModerationRuleValue,
} from '@/lib/shared/db-types'
import {
  resolveWorkspaceModeration,
  type ModerationAxis,
  type RequireApprovalLevel,
} from '@/lib/shared/moderation-policy'
import { INLINE_LINK } from '@/components/admin/settings/inline-link'

/**
 * Per-board moderation form (R4 design, standalone page).
 *
 * Three tri-state rules (`inherit | on | off`) for anonPosts, signedPosts,
 * and comments. Each row's "Inherit" sub-pill shows the workspace's
 * resolved default ("On" / "Off") so admins can tell what they'd fall back
 * to.
 *
 * Changes autosave after a short pause. The form only mutates the
 * `moderation` slice and preserves the rest of `board.access` verbatim so a
 * concurrent edit on the Access page is never zeroed out.
 */

const AUTOSAVE_DELAY_MS = 400

// ─── Rule config ──────────────────────────────────────────────────────

interface ModerationRuleMeta {
  id: ModerationAxis
  label: string
  sub: string
}

const MOD_RULES: readonly ModerationRuleMeta[] = [
  {
    id: 'anonPosts',
    label: 'Require approval for anonymous posts',
    sub: 'Posts from visitors without an account wait for review before they appear.',
  },
  {
    id: 'signedPosts',
    label: 'Require approval for signed-in posts',
    sub: 'Posts from signed-in users wait for review before they appear.',
  },
  {
    id: 'comments',
    label: 'Require approval for new comments',
    sub: 'Comments wait for review before they appear under a post.',
  },
] as const

// ─── Form shape ───────────────────────────────────────────────────────

interface Board {
  id: BoardId
  access: BoardAccess
}

interface BoardModerationFormProps {
  board: Board
}

type ModerationShape = BoardAccess['moderation']

export function BoardModerationForm({ board }: BoardModerationFormProps) {
  const mutation = useUpdateBoardAccess()

  // Non-suspense so the form keeps rendering when the portalConfig cache
  // is empty (e.g. in tests). The default falls back to "none" so the
  // inheritance pill stays conservative until we know better.
  const portalConfigQuery = useQuery({ ...settingsQueries.portalConfig(), retry: false })
  const workspaceApproval: RequireApprovalLevel =
    portalConfigQuery.data?.moderationDefault?.requireApproval ?? 'none'

  const defaults: ModerationShape = board.access?.moderation ?? DEFAULT_BOARD_ACCESS.moderation

  const form = useForm<ModerationShape>({
    defaultValues: defaults,
  })

  // Sync form state when the server-side board.access changes (e.g. after
  // a successful save invalidates the boards query). We key on a stable
  // serialisation of the moderation slice so the form only resets when
  // the server-side data actually changes, not on every parent rerender.
  const moderationKey = JSON.stringify(defaults)
  useEffect(() => {
    form.reset(defaults)
  }, [moderationKey, defaults, form])

  const values = form.watch()
  const dirty = form.formState.isDirty

  const handleChange = useCallback(
    (axis: ModerationAxis, value: ModerationRuleValue) => {
      form.setValue(axis, value, { shouldDirty: true })
    },
    [form]
  )

  // Only touch the moderation slice; preserve the rest of access so a
  // concurrent edit on the Access page isn't zeroed out.
  const { queue, cancel } = useDebouncedSave<ModerationShape>(
    (next) => mutation.mutate({ boardId: board.id, access: { ...board.access, moderation: next } }),
    AUTOSAVE_DELAY_MS
  )

  // Returning every rule to its saved value leaves nothing to save, so a
  // save queued for the undone edit is dropped.
  const valuesKey = JSON.stringify(values)
  useEffect(() => {
    if (dirty) queue(form.getValues())
    else cancel()
  }, [valuesKey, dirty, form, queue, cancel])

  const anyOverridden = MOD_RULES.some((r) => values[r.id] !== 'inherit')

  return (
    <form onSubmit={(e) => e.preventDefault()} className="space-y-4">
      {/* Inheritance banner */}
      <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/30 px-3 py-2">
        <div className="flex-1 text-[13px] text-foreground/90">
          {anyOverridden ? (
            <>
              This board <span className="font-medium text-primary">overrides</span> some workspace
              defaults.
            </>
          ) : (
            <>Inheriting all workspace defaults.</>
          )}
        </div>
        <Link
          to="/admin/settings/moderation"
          className={`${INLINE_LINK} text-[13px] whitespace-nowrap`}
        >
          Workspace moderation →
        </Link>
      </div>

      <SettingRows>
        {MOD_RULES.map((r) => (
          <ModerationRuleRow
            key={r.id}
            rule={r}
            value={values[r.id]}
            // Resolve the "Inherit" option via the shared helper so the UI
            // label and the server gate can never desync.
            workspaceDefault={resolveWorkspaceModeration(r.id, workspaceApproval)}
            onChange={(v) => handleChange(r.id, v)}
          />
        ))}
      </SettingRows>

      <p className="pt-2 text-[13px] text-muted-foreground">
        Held posts and comments appear in the{' '}
        <Link to="/admin/feedback/moderation" className={INLINE_LINK}>
          review queue
        </Link>
        .
      </p>
    </form>
  )
}

// ─── Rule row ────────────────────────────────────────────────────────

interface ModerationRuleRowProps {
  rule: ModerationRuleMeta
  value: ModerationRuleValue
  workspaceDefault: 'on' | 'off'
  onChange: (value: ModerationRuleValue) => void
}

function ModerationRuleRow({ rule, value, workspaceDefault, onChange }: ModerationRuleRowProps) {
  const options: ReadonlyArray<{ value: ModerationRuleValue; label: string }> = [
    { value: 'inherit', label: `Inherit (${workspaceDefault === 'on' ? 'On' : 'Off'})` },
    { value: 'on', label: 'On' },
    { value: 'off', label: 'Off' },
  ]
  return (
    <SettingRow
      label={rule.label}
      description={rule.sub}
      badge={
        value !== 'inherit' ? (
          <Badge variant="outline" size="sm">
            Override
          </Badge>
        ) : undefined
      }
      control={
        <SegmentedControl label={rule.label} options={options} value={value} onChange={onChange} />
      }
    />
  )
}
