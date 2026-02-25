'use client'

import { useState } from 'react'
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  ArrowPathIcon,
  BoltIcon,
  TagIcon,
} from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { EmptyState } from '@/components/shared/empty-state'
import { SegmentFormDialog } from '@/components/admin/segments/segment-form'
import type { SegmentFormValues, RuleCondition } from '@/components/admin/segments/segment-form'
import {
  getAutoColor,
  serializeCondition,
  deserializeCondition,
} from '@/components/admin/segments/segment-utils'
import type { SegmentCondition } from '@/lib/shared/db-types'
import { useSegments } from '@/lib/client/hooks/use-segments-queries'
import { useUserAttributes } from '@/lib/client/hooks/use-user-attributes-queries'
import {
  useCreateSegment,
  useUpdateSegment,
  useDeleteSegment,
  useEvaluateSegment,
  useEvaluateAllSegments,
} from '@/lib/client/mutations'
import type { SegmentId } from '@quackback/ids'

type SegmentItem = NonNullable<ReturnType<typeof useSegments>['data']>[number]

function SegmentRow({
  segment,
  onEdit,
  onDelete,
  onEvaluate,
  isEvaluating,
}: {
  segment: SegmentItem
  onEdit: () => void
  onDelete: () => void
  onEvaluate: () => void
  isEvaluating: boolean
}) {
  return (
    <div className="flex items-center gap-4 py-3 border-b border-border/30 last:border-0">
      {/* Color dot + name */}
      <div className="flex items-center gap-2.5 flex-1 min-w-0">
        <span
          className="h-3 w-3 rounded-full shrink-0 ring-1 ring-inset ring-black/10"
          style={{ backgroundColor: segment.color }}
        />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm text-foreground truncate">{segment.name}</span>
            {segment.type === 'dynamic' && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 gap-0.5">
                <BoltIcon className="h-2.5 w-2.5" />
                Auto
              </Badge>
            )}
          </div>
          {segment.description && (
            <p className="text-xs text-muted-foreground truncate">{segment.description}</p>
          )}
        </div>
      </div>

      {/* Member count */}
      <span className="text-sm text-muted-foreground shrink-0 tabular-nums">
        {segment.memberCount} {segment.memberCount === 1 ? 'user' : 'users'}
      </span>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0">
        {segment.type === 'dynamic' && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs text-muted-foreground"
            onClick={onEvaluate}
            disabled={isEvaluating}
            title="Re-evaluate membership"
          >
            <ArrowPathIcon className={`h-3.5 w-3.5 ${isEvaluating ? 'animate-spin' : ''}`} />
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-muted-foreground hover:text-foreground"
          onClick={onEdit}
          title="Edit segment"
        >
          <PencilIcon className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-muted-foreground hover:text-destructive"
          onClick={onDelete}
          title="Delete segment"
        >
          <TrashIcon className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}

export function SegmentList() {
  const { data: segments, isLoading } = useSegments()
  const { data: customAttributes } = useUserAttributes()
  const createSegment = useCreateSegment()
  const updateSegment = useUpdateSegment()
  const deleteSegment = useDeleteSegment()
  const evaluateSegment = useEvaluateSegment()
  const evaluateAll = useEvaluateAllSegments()

  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<SegmentItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<SegmentItem | null>(null)
  const [evaluatingId, setEvaluatingId] = useState<SegmentId | null>(null)

  const handleCreate = async (values: SegmentFormValues) => {
    const segmentIndex = segments?.length ?? 0
    await createSegment.mutateAsync({
      name: values.name,
      description: values.description || undefined,
      type: values.type,
      color: getAutoColor(segmentIndex),
      rules:
        values.type === 'dynamic' && values.rules.conditions.length > 0
          ? {
              match: values.rules.match,
              conditions: values.rules.conditions.map((c) =>
                serializeCondition(c, customAttributes)
              ),
            }
          : undefined,
      evaluationSchedule:
        values.type === 'dynamic' ? { enabled: true, pattern: '0 * * * *' } : undefined,
    })
    setCreateOpen(false)
  }

  const handleUpdate = async (values: SegmentFormValues) => {
    if (!editTarget) return
    await updateSegment.mutateAsync({
      segmentId: editTarget.id as SegmentId,
      name: values.name,
      description: values.description || null,
      rules:
        editTarget.type === 'dynamic'
          ? values.rules.conditions.length > 0
            ? {
                match: values.rules.match,
                conditions: values.rules.conditions.map((c) =>
                  serializeCondition(c, customAttributes)
                ),
              }
            : null
          : undefined,
      evaluationSchedule:
        editTarget.type === 'dynamic' ? { enabled: true, pattern: '0 * * * *' } : undefined,
    })
    setEditTarget(null)
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    await deleteSegment.mutateAsync(deleteTarget.id as SegmentId)
    setDeleteTarget(null)
  }

  const handleEvaluate = async (segmentId: SegmentId) => {
    setEvaluatingId(segmentId)
    try {
      await evaluateSegment.mutateAsync(segmentId)
    } finally {
      setEvaluatingId(null)
    }
  }

  const dynamicSegments = (segments ?? []).filter((s) => s.type === 'dynamic')

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-12 bg-muted/30 rounded-lg animate-pulse" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header actions */}
      <div className="flex items-center justify-between gap-3">
        <div />
        <div className="flex items-center gap-2">
          {dynamicSegments.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => evaluateAll.mutate()}
              disabled={evaluateAll.isPending}
            >
              <ArrowPathIcon
                className={`h-3.5 w-3.5 ${evaluateAll.isPending ? 'animate-spin' : ''}`}
              />
              Re-evaluate all
            </Button>
          )}
          <Button size="sm" className="h-8 text-xs gap-1.5" onClick={() => setCreateOpen(true)}>
            <PlusIcon className="h-3.5 w-3.5" />
            New segment
          </Button>
        </div>
      </div>

      {/* List */}
      {!segments || segments.length === 0 ? (
        <EmptyState
          icon={TagIcon}
          title="No segments yet"
          description="Create segments to organize your users into groups for filtering and analysis."
          action={
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <PlusIcon className="h-4 w-4 mr-1.5" />
              New segment
            </Button>
          }
          className="py-12"
        />
      ) : (
        <div className="border border-border/50 rounded-lg overflow-hidden bg-card">
          <div className="px-4">
            {segments.map((seg) => (
              <SegmentRow
                key={seg.id}
                segment={seg}
                onEdit={() => setEditTarget(seg)}
                onDelete={() => setDeleteTarget(seg)}
                onEvaluate={() => handleEvaluate(seg.id as SegmentId)}
                isEvaluating={evaluatingId === seg.id}
              />
            ))}
          </div>
        </div>
      )}

      {/* Create dialog */}
      <SegmentFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSubmit={handleCreate}
        isPending={createSegment.isPending}
        customAttributes={customAttributes}
      />

      {/* Edit dialog */}
      <SegmentFormDialog
        open={!!editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        initialValues={
          editTarget
            ? {
                id: editTarget.id as SegmentId,
                name: editTarget.name,
                description: editTarget.description ?? '',
                type: editTarget.type as 'manual' | 'dynamic',
                rules: editTarget.rules
                  ? {
                      match: editTarget.rules.match,
                      conditions: editTarget.rules.conditions.map((c: SegmentCondition) =>
                        deserializeCondition(c, customAttributes)
                      ) as unknown as RuleCondition[],
                    }
                  : { match: 'all', conditions: [] },
              }
            : undefined
        }
        onSubmit={handleUpdate}
        isPending={updateSegment.isPending}
        customAttributes={customAttributes}
      />

      {/* Delete confirm */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete "${deleteTarget?.name}"?`}
        description="This will permanently delete the segment and remove all user memberships. This cannot be undone."
        confirmLabel="Delete"
        variant="destructive"
        isPending={deleteSegment.isPending}
        onConfirm={handleDelete}
      />
    </div>
  )
}
