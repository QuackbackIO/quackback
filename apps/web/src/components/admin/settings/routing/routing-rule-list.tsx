/**
 * Routing rule list with drag-reorder. Lower priority = runs first.
 * Shows priority badge, name, scope, enabled toggle, match stats, edit/delete.
 */
import { useState, useEffect } from 'react'
import { useSuspenseQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Bars3Icon, PencilSquareIcon, TrashIcon } from '@heroicons/react/24/outline'
import type { InboxId, RoutingRuleId } from '@quackback/ids'
import type { RoutingRule } from '@/lib/shared/db-types'
import {
  reorderRoutingRulesFn,
  updateRoutingRuleFn,
  deleteRoutingRuleFn,
} from '@/lib/server/functions/routing'
import { routingRuleQueries } from '@/lib/client/queries/routing-rules'
import { inboxQueries } from '@/lib/client/queries/inboxes'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { PermissionGate } from '@/components/admin/shared/permission-gate'
import { PERMISSIONS } from '@/lib/server/domains/authz'
import { RoutingRuleEditorSheet } from './routing-rule-editor-sheet'

interface Props {
  inboxIdScope?: InboxId | 'workspace'
}

export function RoutingRuleList({ inboxIdScope }: Props) {
  const qc = useQueryClient()
  const listKey = routingRuleQueries.list({ inboxIdScope }).queryKey
  const { data: serverRules } = useSuspenseQuery(routingRuleQueries.list({ inboxIdScope }))
  const { data: inboxes } = useSuspenseQuery(inboxQueries.list({ includeArchived: true }))

  // Local mirror so optimistic reorder can render before server confirms.
  const [rules, setRules] = useState<RoutingRule[]>(serverRules)
  useEffect(() => {
    setRules(serverRules)
  }, [serverRules])

  const inboxLabel = (id: string | null): string => {
    if (!id) return 'Workspace'
    const ix = inboxes.find((i) => i.id === id)
    return ix ? ix.slug : '—'
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const reorderMutation = useMutation({
    mutationFn: (orderedIds: RoutingRuleId[]) => reorderRoutingRulesFn({ data: { orderedIds } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['routing-rules'] }),
    onError: (e: Error) => {
      toast.error(e.message)
      setRules(serverRules)
    },
  })

  const toggleEnabledMutation = useMutation({
    mutationFn: (vars: { ruleId: RoutingRuleId; enabled: boolean }) =>
      updateRoutingRuleFn({ data: { ruleId: vars.ruleId, enabled: vars.enabled } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['routing-rules'] }),
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: (ruleId: RoutingRuleId) => deleteRoutingRuleFn({ data: { ruleId } }),
    onSuccess: () => {
      toast.success('Rule deleted')
      qc.invalidateQueries({ queryKey: ['routing-rules'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = rules.findIndex((r) => r.id === active.id)
    const newIndex = rules.findIndex((r) => r.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const next = arrayMove(rules, oldIndex, newIndex)
    setRules(next)
    reorderMutation.mutate(next.map((r) => r.id as RoutingRuleId))
  }

  // Force the listKey to be referenced so eslint doesn't flag it; the queryKey
  // itself is consumed by useSuspenseQuery via routingRuleQueries.list().
  void listKey

  if (rules.length === 0) {
    return (
      <div className="rounded-md border border-border/50 p-8 text-center text-sm text-muted-foreground">
        No routing rules yet.
      </div>
    )
  }

  return (
    <div className="rounded-md border border-border/50 divide-y divide-border/50">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={rules.map((r) => r.id)} strategy={verticalListSortingStrategy}>
          {rules.map((rule, idx) => (
            <SortableRuleRow
              key={rule.id}
              rule={rule}
              position={idx + 1}
              inboxLabel={inboxLabel(rule.inboxIdScope as string | null)}
              onToggleEnabled={(enabled) =>
                toggleEnabledMutation.mutate({ ruleId: rule.id as RoutingRuleId, enabled })
              }
              onDelete={() => deleteMutation.mutate(rule.id as RoutingRuleId)}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  )
}

interface RowProps {
  rule: RoutingRule
  position: number
  inboxLabel: string
  onToggleEnabled: (enabled: boolean) => void
  onDelete: () => void
}

function SortableRuleRow({ rule, position, inboxLabel, onToggleEnabled, onDelete }: RowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: rule.id,
  })
  const [editOpen, setEditOpen] = useState(false)
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const conditions = (rule.conditions as { conditions?: unknown[] } | null)?.conditions ?? []
  const actions = (rule.actions as unknown[]) ?? []
  const lastMatched = rule.lastMatchedAt ? new Date(rule.lastMatchedAt as unknown as string) : null

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 px-3 py-2 hover:bg-muted/30 group"
    >
      <PermissionGate
        permission={PERMISSIONS.ROUTING_RULE_MANAGE}
        fallback={<div className="w-3.5" />}
      >
        <button
          {...attributes}
          {...listeners}
          className="touch-none cursor-grab active:cursor-grabbing"
          aria-label="Drag to reorder"
        >
          <Bars3Icon className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
        </button>
      </PermissionGate>

      <Badge variant="outline" className="font-mono text-[10px] w-8 justify-center">
        {position}
      </Badge>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{rule.name}</span>
          <Badge variant="outline" className="text-[10px]">
            {inboxLabel}
          </Badge>
        </div>
        <div className="text-[11px] text-muted-foreground mt-0.5">
          {conditions.length} condition{conditions.length === 1 ? '' : 's'} · {actions.length}{' '}
          action{actions.length === 1 ? '' : 's'} · {rule.matchCount} match
          {rule.matchCount === 1 ? '' : 'es'}
          {lastMatched && (
            <>
              {' · last '}
              {lastMatched.toLocaleDateString()}
            </>
          )}
        </div>
      </div>

      <PermissionGate
        permission={PERMISSIONS.ROUTING_RULE_MANAGE}
        fallback={
          <Badge variant="outline" className="text-[10px]">
            {rule.enabled ? 'Enabled' : 'Disabled'}
          </Badge>
        }
      >
        <Switch checked={rule.enabled} onCheckedChange={onToggleEnabled} />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          onClick={() => setEditOpen(true)}
          aria-label="Edit rule"
        >
          <PencilSquareIcon className="h-3.5 w-3.5" />
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label="Delete rule">
              <TrashIcon className="h-3.5 w-3.5" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete this routing rule?</AlertDialogTitle>
              <AlertDialogDescription>
                "{rule.name}" will stop running on incoming tickets. This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </PermissionGate>

      <RoutingRuleEditorSheet open={editOpen} onOpenChange={setEditOpen} rule={rule} />
    </div>
  )
}
