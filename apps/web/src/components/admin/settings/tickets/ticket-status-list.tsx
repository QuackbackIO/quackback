import { useEffect, useState } from 'react'
import { useMutation, useSuspenseQuery, useQueryClient } from '@tanstack/react-query'
import { AUTOSAVE } from '@/lib/client/autosave'
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
import { Bars3Icon, LockClosedIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
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
import { RowDot, SettingsList, SettingsListRow } from '@/components/admin/settings/settings-list'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
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

/** Each category's effect on an SLA clock, shown in its card title (the label
 *  comes from the shared TICKET_STATUS_CATEGORY_LABELS). */
const CATEGORY_SLA: Record<TicketStatusCategory, string> = {
  open: 'SLA runs',
  pending: 'SLA pauses',
  closed: 'SLA stops',
}

const KEY = ticketStatusesQuery.queryKey

type StatusDraft = {
  name: string
  color: string
  category: TicketStatusCategory
  publicStage: TicketStage | null
}

export function TicketStatusList({
  creating,
  onCreatingChange,
}: {
  /** The page header's "New status" button opens the editor for a fresh status. */
  creating: boolean
  onCreatingChange: (creating: boolean) => void
}) {
  const qc = useQueryClient()
  const { data: statuses } = useSuspenseQuery(ticketStatusesQuery)
  const { data: stageLabels } = useSuspenseQuery(ticketStageLabelsQuery)

  const [pendingId, setPendingId] = useState<string | null>(null)
  const [editing, setEditing] = useState<TicketStatusEntity | null>(null)
  const [toDelete, setToDelete] = useState<TicketStatusEntity | null>(null)
  const dialogOpen = creating || editing !== null

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

  // Reorders and stage changes save on change; the global handler toasts a
  // failure, so these only restore the previous order or stage.
  const reorderMutation = useMutation({
    meta: AUTOSAVE,
    mutationFn: (orderedIds: string[]) => reorderTicketStatusesFn({ data: { orderedIds } }),
  })
  const stageMutation = useMutation({
    meta: AUTOSAVE,
    mutationFn: (input: { id: string; publicStage: TicketStage | null }) =>
      updateTicketStatusFn({ data: input }),
  })

  function handleDragEnd(event: DragEndEvent) {
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
    reorderMutation.mutateAsync(reordered.map((s) => s.id)).catch(() => writeCache(statuses))
  }

  function setPublicStage(status: TicketStatusEntity, value: string) {
    const publicStage = value === HIDDEN ? null : (value as TicketStage)
    setPendingId(status.id)
    writeCache(statuses.map((s) => (s.id === status.id ? { ...s, publicStage } : s)))
    // Per-call rollback: each save restores only its own status, so overlapping
    // saves on the shared mutation cannot drop one another's rollback.
    stageMutation
      .mutateAsync({ id: status.id, publicStage })
      .then((saved) =>
        writeCache(
          (qc.getQueryData<TicketStatusEntity[]>(KEY) ?? statuses).map((s) =>
            s.id === status.id ? saved : s
          )
        )
      )
      .catch(() =>
        writeCache(
          (qc.getQueryData<TicketStatusEntity[]>(KEY) ?? statuses).map((s) =>
            s.id === status.id ? { ...s, publicStage: status.publicStage } : s
          )
        )
      )
      .finally(() => setPendingId((id) => (id === status.id ? null : id)))
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
    <>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        {TICKET_STATUS_CATEGORIES.map((category) => {
          const group = byCategory[category]
          if (group.length === 0) return null
          return (
            <SettingsCard
              key={category}
              title={`${TICKET_STATUS_CATEGORY_LABELS[category]} · ${CATEGORY_SLA[category]}`}
              flush
            >
              <SortableContext
                items={group.map((s) => s.id)}
                strategy={verticalListSortingStrategy}
              >
                <SettingsList>
                  {group.map((status) => (
                    <StatusRow
                      key={status.id}
                      status={status}
                      stageLabels={stageLabels}
                      canDelete={!status.isDefault}
                      lastInCategory={group.length === 1}
                      busy={pendingId === status.id}
                      onStageChange={(v) => setPublicStage(status, v)}
                      onEdit={() => setEditing(status)}
                      onDelete={() => setToDelete(status)}
                    />
                  ))}
                </SettingsList>
              </SortableContext>
            </SettingsCard>
          )
        })}
      </DndContext>

      <StatusDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setEditing(null)
            onCreatingChange(false)
          }
        }}
        status={editing}
        stageLabels={stageLabels}
        onSubmit={handleSubmit}
      />

      <ConfirmDialog
        open={!!toDelete}
        onOpenChange={() => setToDelete(null)}
        title="Delete status?"
        description={`Delete "${toDelete?.name}"? Tickets using it must be reassigned first.`}
        confirmLabel="Delete status"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </>
  )
}

interface StatusRowProps {
  status: TicketStatusEntity
  stageLabels: Record<TicketStage, string>
  canDelete: boolean
  lastInCategory: boolean
  busy: boolean
  onStageChange: (value: string) => void
  onEdit: () => void
  onDelete: () => void
}

function StatusRow({
  status,
  stageLabels,
  canDelete,
  lastInCategory,
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
  return (
    <div ref={setNodeRef} style={style}>
      <SettingsListRow
        grip={
          <button
            {...attributes}
            {...listeners}
            className="touch-none cursor-grab active:cursor-grabbing"
            aria-label={`Reorder ${status.name}`}
          >
            <Bars3Icon className="size-4 text-muted-foreground/70" />
          </button>
        }
        leading={<RowDot color={status.color} />}
        title={
          <span className="inline-flex items-center gap-1.5">
            {status.name}
            {status.isDefault && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span role="img" aria-label="Default status">
                      <LockClosedIcon className="h-3 w-3 text-muted-foreground" />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>The default status for new tickets. It can't be deleted.</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </span>
        }
        actionsLabel={status.name}
        trailing={
          <Select
            value={status.publicStage ?? HIDDEN}
            onValueChange={onStageChange}
            disabled={busy}
          >
            <SelectTrigger
              size="sm"
              className="w-44"
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
        }
        actions={[
          { label: 'Edit', onSelect: onEdit },
          ...(canDelete
            ? [
                {
                  label: 'Delete',
                  destructive: true,
                  onSelect: onDelete,
                  disabled: lastInCategory,
                  hint: lastInCategory ? 'Keep at least one status in each category' : undefined,
                },
              ]
            : []),
        ]}
      />
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
                      {TICKET_STATUS_CATEGORY_LABELS[c]} · {CATEGORY_SLA[c]}
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
