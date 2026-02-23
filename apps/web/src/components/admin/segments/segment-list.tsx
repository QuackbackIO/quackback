'use client'

import { useState } from 'react'
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  ArrowPathIcon,
  BoltIcon,
  ClockIcon,
} from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { EmptyState } from '@/components/shared/empty-state'
import { SegmentFormDialog } from '@/components/admin/segments/segment-form'
import type { SegmentFormValues, RuleCondition } from '@/components/admin/segments/segment-form'
import type { SegmentCondition } from '@/lib/shared/db-types'
import { useSegments } from '@/lib/client/hooks/use-segments-queries'
import { useUserAttributes } from '@/lib/client/hooks/use-user-attributes-queries'
import type { UserAttributeItem } from '@/lib/client/hooks/use-user-attributes-queries'
import {
  useCreateSegment,
  useUpdateSegment,
  useDeleteSegment,
  useEvaluateSegment,
  useEvaluateAllSegments,
} from '@/lib/client/mutations'
import type { SegmentId } from '@quackback/ids'
import { TagIcon } from '@heroicons/react/24/solid'

// ============================================
// Types
// ============================================

type SegmentItem = NonNullable<ReturnType<typeof useSegments>['data']>[number]

// ============================================
// Segment row
// ============================================

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
            {segment.type === 'dynamic' && hasEvaluationSchedule(segment) && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 gap-0.5">
                <ClockIcon className="h-2.5 w-2.5" />
                Scheduled
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

// ============================================
// Segment list (main component)
// ============================================

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
    await createSegment.mutateAsync({
      name: values.name,
      description: values.description || undefined,
      type: values.type,
      color: values.color,
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
        values.type === 'dynamic' && values.evaluationSchedule.enabled
          ? { enabled: true, pattern: values.evaluationSchedule.pattern }
          : undefined,
      weightConfig: values.weightConfig.enabled
        ? {
            attribute: {
              key: values.weightConfig.attributeKey,
              label: values.weightConfig.attributeLabel,
              type: values.weightConfig.attributeType,
              ...(values.weightConfig.attributeType === 'currency'
                ? { currencyCode: values.weightConfig.currencyCode }
                : {}),
            },
            aggregation: values.weightConfig.aggregation,
          }
        : undefined,
    })
    setCreateOpen(false)
  }

  const handleUpdate = async (values: SegmentFormValues) => {
    if (!editTarget) return
    await updateSegment.mutateAsync({
      segmentId: editTarget.id as SegmentId,
      name: values.name,
      description: values.description || null,
      color: values.color,
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
        editTarget.type === 'dynamic'
          ? values.evaluationSchedule.enabled
            ? { enabled: true, pattern: values.evaluationSchedule.pattern }
            : { enabled: false, pattern: values.evaluationSchedule.pattern }
          : undefined,
      weightConfig: values.weightConfig.enabled
        ? {
            attribute: {
              key: values.weightConfig.attributeKey,
              label: values.weightConfig.attributeLabel,
              type: values.weightConfig.attributeType,
              ...(values.weightConfig.attributeType === 'currency'
                ? { currencyCode: values.weightConfig.currencyCode }
                : {}),
            },
            aggregation: values.weightConfig.aggregation,
          }
        : null,
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
                color: editTarget.color,
                rules: editTarget.rules
                  ? {
                      match: editTarget.rules.match,
                      conditions: editTarget.rules.conditions.map((c: SegmentCondition) =>
                        deserializeCondition(c, customAttributes)
                      ) as unknown as RuleCondition[],
                    }
                  : { match: 'all', conditions: [] },
                evaluationSchedule: (() => {
                  const sched = (editTarget as Record<string, unknown>).evaluationSchedule as
                    | { enabled?: boolean; pattern?: string }
                    | null
                    | undefined
                  return {
                    enabled: sched?.enabled ?? false,
                    pattern: sched?.pattern ?? '0 0 * * *',
                  }
                })(),
                weightConfig: (() => {
                  const wc = (editTarget as Record<string, unknown>).weightConfig as
                    | {
                        attribute?: {
                          key?: string
                          label?: string
                          type?: string
                          currencyCode?: string
                        }
                        aggregation?: string
                      }
                    | null
                    | undefined
                  return {
                    enabled: !!wc,
                    attributeKey: wc?.attribute?.key ?? 'mrr',
                    attributeLabel: wc?.attribute?.label ?? 'MRR',
                    attributeType: (wc?.attribute?.type ?? 'currency') as
                      | 'string'
                      | 'number'
                      | 'boolean'
                      | 'date'
                      | 'currency',
                    currencyCode: wc?.attribute?.currencyCode ?? 'USD',
                    aggregation: (wc?.aggregation ?? 'sum') as
                      | 'sum'
                      | 'average'
                      | 'count'
                      | 'median',
                  }
                })(),
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

// ============================================
// Helpers
// ============================================

function hasEvaluationSchedule(segment: SegmentItem): boolean {
  const sched = (segment as Record<string, unknown>).evaluationSchedule as
    | { enabled?: boolean }
    | null
    | undefined
  return !!sched?.enabled
}

function parseConditionValue(
  attribute: string,
  value: string,
  operator?: string,
  customAttributes?: UserAttributeItem[]
): string | number | boolean | undefined {
  if (operator === 'is_set' || operator === 'is_not_set') return undefined
  if (attribute.startsWith('__custom__') && customAttributes) {
    const key = attribute.slice(10)
    const attr = customAttributes.find((a) => a.key === key)
    if (attr) {
      if (attr.type === 'number' || attr.type === 'currency') return Number(value) || 0
      if (attr.type === 'boolean') return value === 'true'
    }
    return value
  }
  const numericAttributes = ['created_at_days_ago', 'post_count', 'vote_count', 'comment_count']
  if (numericAttributes.includes(attribute)) return Number(value) || 0
  if (attribute === 'email_verified') return value === 'true'
  return value
}

function serializeCondition(
  c: RuleCondition,
  customAttributes?: UserAttributeItem[]
): {
  attribute: string
  operator: string
  value?: string | number | boolean
  metadataKey?: string
} {
  if (c.attribute.startsWith('__custom__')) {
    const key = c.attribute.slice(10)
    return {
      attribute: 'metadata_key',
      operator: c.operator,
      value: parseConditionValue(c.attribute, c.value, c.operator, customAttributes),
      metadataKey: key,
    }
  }
  return {
    attribute: c.attribute,
    operator: c.operator,
    value: parseConditionValue(c.attribute, c.value, c.operator, customAttributes),
    metadataKey: c.metadataKey,
  }
}

function deserializeCondition(
  c: SegmentCondition,
  customAttributes?: UserAttributeItem[]
): { attribute: string; operator: string; value: string; metadataKey?: string } {
  if (c.attribute === 'metadata_key' && c.metadataKey && customAttributes) {
    const known = customAttributes.find((a) => a.key === c.metadataKey)
    if (known) {
      return {
        attribute: `__custom__${c.metadataKey}`,
        operator: c.operator as string,
        value: c.value != null ? String(c.value) : '',
        metadataKey: c.metadataKey,
      }
    }
  }
  return {
    attribute: c.attribute as string,
    operator: c.operator as string,
    value: c.value != null ? String(c.value) : '',
    metadataKey: c.metadataKey,
  }
}
