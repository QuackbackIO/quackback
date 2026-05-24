import { useForm } from 'react-hook-form'
import { Link } from '@tanstack/react-router'
import { GlobeAltIcon, LockClosedIcon, TagIcon, UsersIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { FormError } from '@/components/shared/form-error'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Label } from '@/components/ui/label'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
} from '@/components/ui/form'
import { SegmentMultiSelect } from '@/components/admin/segments/segment-multi-select'
import { useUpdateBoardAccess } from '@/lib/client/mutations'
import { useSegments } from '@/lib/client/hooks/use-segments-queries'
import type { BoardId } from '@quackback/ids'
import type { BoardAudience } from '@/lib/shared/db-types'

/**
 * Board visibility form. Backed by `audience` (BoardAudience union).
 *
 * Exposes all four audience kinds as radio buttons:
 *   - public          anyone, signed-in or not
 *   - authenticated   any signed-in portal user
 *   - team            admins and members only
 *   - segments        members of one or more named segments
 *
 * When `segments` is selected the SegmentMultiSelect appears below the
 * radio group, preselected from the board's current `segmentIds` if any.
 * Save is disabled while the selection is empty (server requires at
 * least one segment) — explicit, no silent fallback to a different kind.
 *
 * Post moderation is workspace-wide (Settings → Permissions), not per-board.
 *
 * Submit calls `updateBoardAccessFn` (admin-only, audited) — distinct from
 * the general board update path so members can't change board visibility.
 */

interface Board {
  id: BoardId
  audience: BoardAudience
}

interface BoardAccessFormProps {
  board: Board
  /** When false (member role), render a read-only summary instead of
   *  the interactive form. The server rejects audience changes from
   *  non-admins (updateBoardAccessFn is isAdmin-gated), so showing the
   *  editable controls would lead to a 403 on save. */
  canEdit?: boolean
}

type RadioVisibility = 'public' | 'authenticated' | 'team' | 'segments'

interface FormValues {
  visibility: RadioVisibility
  segmentIds: string[]
}

/** Exhaustiveness guard — if BoardAudience gains a new kind, the
 *  switch below produces a compile error rather than silently
 *  returning undefined and crashing the form at mount. */
function assertNever(x: never): never {
  throw new Error(`Unhandled BoardAudience variant: ${JSON.stringify(x)}`)
}

function audienceToFormValues(audience: BoardAudience): FormValues {
  switch (audience.kind) {
    case 'public':
    case 'authenticated':
    case 'team':
      return { visibility: audience.kind, segmentIds: [] }
    case 'segments':
      return { visibility: 'segments', segmentIds: audience.segmentIds }
    default:
      return assertNever(audience)
  }
}

function formValuesToAudience(values: FormValues): BoardAudience {
  switch (values.visibility) {
    case 'public':
    case 'authenticated':
    case 'team':
      return { kind: values.visibility }
    case 'segments':
      return { kind: 'segments', segmentIds: values.segmentIds }
    default:
      return assertNever(values.visibility)
  }
}

/** Shared label/description/icon table — the source of truth for both
 *  the editable form and the read-only summary. Adding a new audience
 *  kind starts here; both views pick it up automatically. */
const AUDIENCE_META: Record<
  BoardAudience['kind'],
  {
    label: string
    description: string
    icon: React.ComponentType<{ className?: string }>
  }
> = {
  public: {
    label: 'Public',
    description:
      'Anyone can view this board on your portal, including unsigned visitors. Signed-in users can vote, comment, and submit feedback.',
    icon: GlobeAltIcon,
  },
  authenticated: {
    label: 'Authenticated',
    description:
      'Any signed-in portal user can view this board. Hidden from anonymous visitors and search indexes.',
    icon: UsersIcon,
  },
  team: {
    label: 'Team only',
    description: 'Only admins and team members can view this board.',
    icon: LockClosedIcon,
  },
  segments: {
    label: 'Specific segments',
    description: 'Only members of the segments you pick can view this board.',
    icon: TagIcon,
  },
}

const AUDIENCE_KINDS: RadioVisibility[] = ['public', 'authenticated', 'team', 'segments']

export function BoardAccessForm({ board, canEdit = true }: BoardAccessFormProps) {
  if (!canEdit) {
    return <BoardAccessSummary audience={board.audience} />
  }
  return <BoardAccessFormInner board={board} />
}

function BoardAccessFormInner({ board }: { board: Board }) {
  const mutation = useUpdateBoardAccess()
  const segmentsQuery = useSegments()

  const form = useForm<FormValues>({
    // Preserves the board's existing segmentIds when it's already on a
    // segments audience so admins editing aren't surprised by an empty
    // selection. Switching back from another kind starts empty.
    defaultValues: audienceToFormValues(board.audience),
  })

  const visibility = form.watch('visibility')
  const segmentIds = form.watch('segmentIds')

  const isSegments = visibility === 'segments'
  const noSegmentsSelected = isSegments && segmentIds.length === 0

  async function onSubmit(values: FormValues) {
    // Belt-and-braces: the disabled Save button covers the click path,
    // but an Enter-key submit from a focused input bypasses `disabled`.
    // Re-check the same condition here so neither channel can land an
    // empty allowlist on the server (the schema also rejects this, but
    // we'd rather not round-trip an obviously-invalid payload).
    if (values.visibility === 'segments' && values.segmentIds.length === 0) {
      return
    }
    mutation.mutate({
      boardId: board.id,
      audience: formValuesToAudience(values),
    })
  }

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {mutation.isError && <FormError message={mutation.error?.message ?? 'An error occurred'} />}

        <FormField
          control={form.control}
          name="visibility"
          render={({ field }) => (
            <FormItem className="space-y-4">
              <div>
                <FormLabel className="text-base">Board Visibility</FormLabel>
                <FormDescription>Control who can see this board on your portal</FormDescription>
              </div>
              <FormControl>
                <RadioGroup
                  onValueChange={(value) => {
                    const next = value as RadioVisibility
                    field.onChange(next)
                    // Leaving segments — clear the selection so a later
                    // re-entry starts fresh and a stale array can't
                    // sneak back into the payload from a hidden field.
                    if (next !== 'segments') {
                      form.setValue('segmentIds', [])
                    }
                  }}
                  value={field.value}
                  className="grid gap-3"
                >
                  {AUDIENCE_KINDS.map((kind) => (
                    <AccessOption key={kind} value={kind} meta={AUDIENCE_META[kind]} />
                  ))}
                </RadioGroup>
              </FormControl>
            </FormItem>
          )}
        />

        {isSegments && (
          <FormField
            control={form.control}
            name="segmentIds"
            render={({ field }) => (
              <FormItem className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <FormLabel className="text-sm">Allowed segments</FormLabel>
                  <Link
                    to="/admin/settings/people"
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Manage segments →
                  </Link>
                </div>
                {segmentsQuery.isLoading ? (
                  <p className="text-xs text-muted-foreground">Loading segments…</p>
                ) : segmentsQuery.isError ? (
                  <p className="text-xs text-destructive">
                    Could not load segments. Reload the page to try again.
                  </p>
                ) : (segmentsQuery.data ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No segments defined yet — create one on the{' '}
                    <Link to="/admin/settings/people" className="text-primary hover:underline">
                      People page
                    </Link>
                    , then come back to pick it.
                  </p>
                ) : (
                  <SegmentMultiSelect
                    segments={segmentsQuery.data ?? []}
                    value={field.value}
                    onChange={(next) => field.onChange(next)}
                    disabled={mutation.isPending}
                  />
                )}
                {noSegmentsSelected && (segmentsQuery.data ?? []).length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Pick at least one segment to save.
                  </p>
                )}
              </FormItem>
            )}
          />
        )}

        <div className="flex justify-end">
          <Button type="submit" disabled={mutation.isPending || noSegmentsSelected}>
            {mutation.isPending ? 'Saving...' : 'Save changes'}
          </Button>
        </div>
      </form>
    </Form>
  )
}

/** Read-only audience summary for non-admin viewers. Mirrors the same
 *  audience labels as the editable form so the two views stay legible
 *  side by side. Lists segment names for `segments` so members know
 *  WHICH segments without having to click into the People page. */
function BoardAccessSummary({ audience }: { audience: BoardAudience }) {
  const segmentsQuery = useSegments({ enabled: audience.kind === 'segments' })
  const { icon: Icon, label, description } = AUDIENCE_META[audience.kind]

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-muted/30 p-4">
        <div className="flex items-start gap-3">
          <Icon className="h-4 w-4 mt-0.5" />
          <div className="flex-1 space-y-1">
            <p className="font-medium text-sm">{label}</p>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
        </div>
        {audience.kind === 'segments' && (
          <div className="mt-3 border-t pt-3">
            <p className="text-xs font-medium mb-1.5">Allowed segments</p>
            {segmentsQuery.isLoading ? (
              <p className="text-xs text-muted-foreground">Loading segments…</p>
            ) : (
              <ul className="text-xs text-muted-foreground space-y-0.5">
                {audience.segmentIds.map((segId) => {
                  const seg = (segmentsQuery.data ?? []).find((s) => s.id === segId)
                  return <li key={segId}>{seg?.name ?? segId}</li>
                })}
              </ul>
            )}
          </div>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Only admins can change board visibility. Ask an admin if you need it changed.
      </p>
    </div>
  )
}

/** Single radio card — same visual treatment for all four kinds.
 *  Driven from AUDIENCE_META so the labels stay in lockstep with the
 *  read-only summary. */
function AccessOption({
  value,
  meta,
}: {
  value: RadioVisibility
  meta: (typeof AUDIENCE_META)[RadioVisibility]
}) {
  const id = `visibility-${value}`
  const Icon = meta.icon
  return (
    <Label
      htmlFor={id}
      className="flex items-start gap-3 rounded-lg border p-4 cursor-pointer hover:bg-muted/50 [&:has([data-state=checked])]:border-primary [&:has([data-state=checked])]:bg-primary/5"
    >
      <RadioGroupItem value={value} id={id} className="mt-0.5" />
      <div className="flex-1 space-y-1">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4" />
          <span className="font-medium">{meta.label}</span>
        </div>
        <p className="text-xs text-muted-foreground">{meta.description}</p>
      </div>
    </Label>
  )
}
