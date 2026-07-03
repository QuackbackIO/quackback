import { useEffect, useState } from 'react'
import { useSuspenseQuery, useQueryClient } from '@tanstack/react-query'
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
import { PlusIcon, Bars3Icon, TrashIcon, PencilSquareIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { cn } from '@/lib/shared/utils'
import { TICKET_STAGES, TICKET_STATUS_CATEGORIES } from '@/lib/shared/db-types'
import type { TicketStatusEntity, TicketStatusCategory, TicketStage } from '@/lib/shared/db-types'
import { TICKET_STATUS_CATEGORY_LABELS } from '@/lib/shared/tickets'
import { ColorPickerGrid, ColorHexInput, randomColor } from '@/components/shared/color-picker'
import {
  createTicketStatusFn,
  updateTicketStatusFn,
  reorderTicketStatusesFn,
  deleteTicketStatusFn,
} from '@/lib/server/functions/tickets'
import { ticketStatusesQuery, ticketStageLabelsQuery } from './queries'

const HIDDEN = 'hidden'

/** Category presentation: effect on an SLA clock and chip colours (label comes
 *  from the shared TICKET_STATUS_CATEGORY_LABELS). */
const CATEGORY_META: Record<TicketStatusCategory, { sla: string; chip: string }> = {
  open: {
    sla: 'SLA runs',
    chip: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  },
  pending: {
    sla: 'SLA pauses',
    chip: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  },
  closed: {
    sla: 'SLA stops',
    chip: 'bg-slate-500/15 text-slate-600 dark:text-slate-400',
  },
}

const KEY = ticketStatusesQuery.queryKey

type StatusDraft = {
  name: string
  color: string
  category: TicketStatusCategory
  publicStage: TicketStage | null
}

export function TicketStatusList() {
  const qc = useQueryClient()
  const { data: statuses } = useSuspenseQuery(ticketStatusesQuery)
  const { data: stageLabels } = useSuspenseQuery(ticketStageLabelsQuery)

  const [pendingId, setPendingId] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<TicketStatusEntity | null>(null)
  const [toDelete, setToDelete] = useState<TicketStatusEntity | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const byCategory = TICKET_STATUS_CATEGORIES.reduce(
    (acc, category) => {
      acc[category] = statuses.filter((s) => s.category === category)
      return acc
    },
    {} as Record<TicketStatusCategory, TicketStatusEntity[]>
  )

  function writeCache(next: TicketStatusEntity[]) {
    qc.setQueryData(KEY, next)
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const activeStatus = statuses.find((s) => s.id === active.id)
    if (!activeStatus) return
    const group = byCategory[activeStatus.category]
    const oldIndex = group.findIndex((s) => s.id === active.id)
    const newIndex = group.findIndex((s) => s.id === over.id)
    if (newIndex === -1) return

    const reordered = arrayMove(group, oldIndex, newIndex)
    const others = statuses.filter((s) => s.category !== activeStatus.category)
    writeCache([...others, ...reordered.map((s, i) => ({ ...s, position: i }))])
    try {
      await reorderTicketStatusesFn({
        data: { orderedIds: reordered.map((s) => s.id) },
      })
    } catch {
      writeCache(statuses)
      toast.error('Failed to reorder statuses')
    }
  }

  async function setPublicStage(status: TicketStatusEntity, value: string) {
    const publicStage = value === HIDDEN ? null : (value as TicketStage)
    setPendingId(status.id)
    writeCache(statuses.map((s) => (s.id === status.id ? { ...s, publicStage } : s)))
    try {
      const saved = await updateTicketStatusFn({ data: { id: status.id, publicStage } })
      writeCache(
        qc.getQueryData<TicketStatusEntity[]>(KEY)!.map((s) => (s.id === status.id ? saved : s))
      )
    } catch (error) {
      writeCache(statuses)
      toast.error(error instanceof Error ? error.message : 'Failed to update customer stage')
    } finally {
      setPendingId(null)
    }
  }

  async function handleSubmit(draft: StatusDraft) {
    if (editing) {
      const saved = await updateTicketStatusFn({ data: { id: editing.id, ...draft } })
      writeCache(
        (qc.getQueryData<TicketStatusEntity[]>(KEY) ?? statuses).map((s) =>
          s.id === editing.id ? saved : s
        )
      )
    } else {
      const created = await createTicketStatusFn({ data: draft })
      writeCache([...(qc.getQueryData<TicketStatusEntity[]>(KEY) ?? statuses), created])
    }
  }

  async function handleDelete() {
    if (!toDelete) return
    try {
      await deleteTicketStatusFn({ data: { id: toDelete.id } })
      writeCache(
        (qc.getQueryData<TicketStatusEntity[]>(KEY) ?? statuses).filter((s) => s.id !== toDelete.id)
      )
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete status')
    } finally {
      setToDelete(null)
    }
  }

  return (
    <SettingsCard
      title="Statuses"
      description="The lifecycle states a ticket moves through. Category sets whether an SLA clock runs, and the customer stage controls what requesters see."
      action={
        <Button
          size="sm"
          onClick={() => {
            setEditing(null)
            setDialogOpen(true)
          }}
        >
          <PlusIcon className="h-4 w-4" /> New status
        </Button>
      }
      contentClassName="p-0"
    >
      <div className="hidden sm:flex items-center gap-3 px-4 sm:px-6 py-2 border-b border-border/50 text-xs font-medium text-muted-foreground">
        <span className="w-4 shrink-0" />
        <span className="flex-1 min-w-0">Status</span>
        <span className="w-28 shrink-0">Category</span>
        <span className="w-44 shrink-0">Customer stage</span>
        <span className="w-14 shrink-0" />
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <div className="divide-y divide-border/40">
          {TICKET_STATUS_CATEGORIES.map((category) => {
            const group = byCategory[category]
            if (group.length === 0) return null
            return (
              <SortableContext
                key={category}
                items={group.map((s) => s.id)}
                strategy={verticalListSortingStrategy}
              >
                {group.map((status) => (
                  <StatusRow
                    key={status.id}
                    status={status}
                    stageLabels={stageLabels}
                    canDelete={!status.isDefault && group.length > 1}
                    busy={pendingId === status.id}
                    onStageChange={(v) => setPublicStage(status, v)}
                    onEdit={() => {
                      setEditing(status)
                      setDialogOpen(true)
                    }}
                    onDelete={() => setToDelete(status)}
                  />
                ))}
              </SortableContext>
            )
          })}
        </div>
      </DndContext>

      <StatusDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        status={editing}
        stageLabels={stageLabels}
        onSubmit={handleSubmit}
      />

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={() => setToDelete(null)}
        title="Delete status"
        description={`Delete "${toDelete?.name}"? Tickets using it must be reassigned first.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </SettingsCard>
  )
}

interface StatusRowProps {
  status: TicketStatusEntity
  stageLabels: Record<TicketStage, string>
  canDelete: boolean
  busy: boolean
  onStageChange: (value: string) => void
  onEdit: () => void
  onDelete: () => void
}

function StatusRow({
  status,
  stageLabels,
  canDelete,
  busy,
  onStageChange,
  onEdit,
  onDelete,
}: StatusRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: status.id,
  })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  const meta = CATEGORY_META[status.category]
  const deleteTitle = status.isDefault
    ? 'Cannot delete the default status'
    : !canDelete
      ? 'Cannot delete the last status in a category'
      : 'Delete status'

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group flex items-center gap-3 px-4 sm:px-6 py-2.5 hover:bg-muted/40"
    >
      <button
        {...attributes}
        {...listeners}
        className="w-4 shrink-0 touch-none cursor-grab active:cursor-grabbing"
        aria-label="Reorder"
      >
        <Bars3Icon className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100" />
      </button>

      <div className="flex-1 min-w-0 flex items-center gap-2">
        <span
          className="h-3 w-3 rounded-full shrink-0"
          style={{ backgroundColor: status.color }}
          aria-hidden
        />
        <span className="truncate text-sm">{status.name}</span>
        {status.isDefault && (
          <Badge variant="subtle" className="shrink-0">
            Default
          </Badge>
        )}
      </div>

      <div className="w-28 shrink-0">
        <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', meta.chip)}>
          {TICKET_STATUS_CATEGORY_LABELS[status.category]}
        </span>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{meta.sla}</p>
      </div>

      <div className="w-44 shrink-0">
        <Select value={status.publicStage ?? HIDDEN} onValueChange={onStageChange} disabled={busy}>
          <SelectTrigger
            size="sm"
            className="w-full"
            aria-label={`Customer stage for ${status.name}`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={HIDDEN}>Hidden</SelectItem>
            {TICKET_STAGES.map((stage) => (
              <SelectItem key={stage} value={stage}>
                {stageLabels[stage]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="w-14 shrink-0 flex items-center justify-end gap-0.5">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground opacity-0 group-hover:opacity-100"
          onClick={onEdit}
          title="Edit status"
        >
          <PencilSquareIcon className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            'h-7 w-7 text-muted-foreground hover:text-destructive',
            !canDelete && 'opacity-40 cursor-not-allowed'
          )}
          onClick={onDelete}
          disabled={!canDelete}
          title={deleteTitle}
        >
          <TrashIcon className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  )
}

interface StatusDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  status: TicketStatusEntity | null
  stageLabels: Record<TicketStage, string>
  onSubmit: (draft: StatusDraft) => Promise<void>
}

function StatusDialog({ open, onOpenChange, status, stageLabels, onSubmit }: StatusDialogProps) {
  const [name, setName] = useState('')
  const [color, setColor] = useState(randomColor())
  const [category, setCategory] = useState<TicketStatusCategory>('open')
  const [publicStage, setPublicStage] = useState<TicketStage | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setError(null)
    if (status) {
      setName(status.name)
      setColor(status.color)
      setCategory(status.category)
      setPublicStage(status.publicStage)
    } else {
      setName('')
      setColor(randomColor())
      setCategory('open')
      setPublicStage(null)
    }
  }, [open, status])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      await onSubmit({ name: name.trim(), color, category, publicStage })
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save status')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{status ? 'Edit status' : 'New status'}</DialogTitle>
          <DialogDescription>
            Statuses group into a category and optionally project to a customer-facing stage.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ticket-status-name">Name</Label>
            <Input
              id="ticket-status-name"
              value={name}
              maxLength={50}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Waiting on customer"
              required
            />
          </div>

          <div className="space-y-2">
            <Label>Color</Label>
            <ColorPickerGrid selectedColor={color} onColorChange={setColor} />
            <ColorHexInput color={color} onColorChange={setColor} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Category</Label>
              <Select
                value={category}
                onValueChange={(v) => setCategory(v as TicketStatusCategory)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TICKET_STATUS_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {TICKET_STATUS_CATEGORY_LABELS[c]} · {CATEGORY_META[c].sla}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Customer stage</Label>
              <Select
                value={publicStage ?? HIDDEN}
                onValueChange={(v) => setPublicStage(v === HIDDEN ? null : (v as TicketStage))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={HIDDEN}>Hidden</SelectItem>
                  {TICKET_STAGES.map((stage) => (
                    <SelectItem key={stage} value={stage}>
                      {stageLabels[stage]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting || !name.trim()}>
              {submitting ? 'Saving…' : status ? 'Save changes' : 'Create status'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
