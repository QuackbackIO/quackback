import { useState, useEffect, useTransition } from 'react'
import { useRouter } from '@tanstack/react-router'
import { useMutation } from '@tanstack/react-query'
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
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { NewButton } from '@/components/shared/new-button'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { SettingsPage } from '@/components/admin/settings/settings-page'
import { RowDot, SettingsList, SettingsListRow } from '@/components/admin/settings/settings-list'
import { AUTOSAVE } from '@/lib/client/autosave'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { ColorPickerGrid, ColorHexInput, randomColor } from '@/components/shared/color-picker'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { PostStatusEntity, StatusCategory } from '@/lib/shared/db-types'
import {
  updateStatusFn,
  deleteStatusFn,
  reorderStatusesFn,
  createStatusFn,
} from '@/lib/server/functions/statuses'

interface StatusListProps {
  initialStatuses: PostStatusEntity[]
}

const CATEGORY_INFO: Record<StatusCategory, { label: string; description: string }> = {
  active: { label: 'Active', description: 'In progress' },
  complete: { label: 'Complete', description: 'Done, shown as completed' },
  closed: { label: 'Closed', description: "Won't be done" },
}

const CATEGORY_ORDER: StatusCategory[] = ['active', 'complete', 'closed']

export function StatusesSettingsPage({ initialStatuses }: StatusListProps) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [statuses, setStatuses] = useState(initialStatuses)
  const [editingStatus, setEditingStatus] = useState<PostStatusEntity | null>(null)
  const [deleteStatus, setDeleteStatus] = useState<PostStatusEntity | null>(null)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)

  // Configure DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Group statuses by category
  const statusesByCategory = CATEGORY_ORDER.reduce(
    (acc, category) => {
      acc[category] = statuses
        .filter((s) => s.category === category)
        .sort((a, b) => a.position - b.position)
      return acc
    },
    {} as Record<StatusCategory, PostStatusEntity[]>
  )

  // Reorder, roadmap and colour changes save on change. A failure reverts the
  // optimistic value; the autosave handler shows the one toast.
  const reorderMutation = useMutation({
    mutationFn: (statusIds: string[]) => reorderStatusesFn({ data: { statusIds } }),
    meta: AUTOSAVE,
    onSuccess: () => startTransition(() => router.invalidate()),
    onError: () => setStatuses(initialStatuses),
  })

  const roadmapMutation = useMutation({
    mutationFn: (input: { id: string; showOnRoadmap: boolean }) => updateStatusFn({ data: input }),
    meta: AUTOSAVE,
    onSuccess: () => startTransition(() => router.invalidate()),
    onError: (_error, input) =>
      setStatuses((prev) =>
        prev.map((s) => (s.id === input.id ? { ...s, showOnRoadmap: !input.showOnRoadmap } : s))
      ),
  })

  const colorMutation = useMutation({
    mutationFn: (input: { id: string; color: string; previousColor: string }) =>
      updateStatusFn({ data: { id: input.id, color: input.color } }),
    meta: AUTOSAVE,
    onSuccess: () => startTransition(() => router.invalidate()),
    onError: (_error, input) =>
      setStatuses((prev) =>
        prev.map((s) => (s.id === input.id ? { ...s, color: input.previousColor } : s))
      ),
  })

  // Handle drag end: reorder and save immediately
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const activeStatus = statuses.find((s) => s.id === active.id)
    if (!activeStatus) return

    const category = activeStatus.category
    const categoryStatuses = statusesByCategory[category]

    const oldIndex = categoryStatuses.findIndex((s) => s.id === active.id)
    const newIndex = categoryStatuses.findIndex((s) => s.id === over.id)
    if (newIndex === -1) return

    const reorderedCategory = arrayMove(categoryStatuses, oldIndex, newIndex)
    setStatuses((prev) => {
      const others = prev.filter((s) => s.category !== category)
      return [...others, ...reorderedCategory.map((s, i) => ({ ...s, position: i }))]
    })
    reorderMutation.mutate(reorderedCategory.map((s) => s.id))
  }

  const handleToggleRoadmap = (status: PostStatusEntity) => {
    const showOnRoadmap = !status.showOnRoadmap
    setStatuses((prev) => prev.map((s) => (s.id === status.id ? { ...s, showOnRoadmap } : s)))
    roadmapMutation.mutate({ id: status.id, showOnRoadmap })
  }

  const handleColorChange = (status: PostStatusEntity, color: string) => {
    setStatuses((prev) => prev.map((s) => (s.id === status.id ? { ...s, color } : s)))
    colorMutation.mutate({ id: status.id, color, previousColor: status.color })
  }

  const handleDelete = async () => {
    if (!deleteStatus) return

    try {
      await deleteStatusFn({ data: { id: deleteStatus.id } })
      setStatuses((prev) => prev.filter((s) => s.id !== deleteStatus.id))
      startTransition(() => router.invalidate())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete status')
    } finally {
      setDeleteStatus(null)
    }
  }

  const handleCreate = async (data: {
    name: string
    slug: string
    color: string
    category: StatusCategory
  }) => {
    try {
      const newStatus = await createStatusFn({
        data: {
          ...data,
          position: statusesByCategory[data.category].length,
        },
      })

      setStatuses((prev) => [...prev, newStatus as PostStatusEntity])
      setCreateDialogOpen(false)
      startTransition(() => router.invalidate())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create status')
    }
  }

  return (
    <SettingsPage
      page="/admin/settings/statuses"
      actions={<NewButton noun="status" onClick={() => setCreateDialogOpen(true)} />}
    >
      {/* Status categories with drag and drop */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        {CATEGORY_ORDER.map((category) => {
          const categoryStatuses = statusesByCategory[category]
          const canDeleteInCategory = categoryStatuses.length > 1

          return (
            <SettingsCard
              key={category}
              title={CATEGORY_INFO[category].label}
              description={CATEGORY_INFO[category].description}
              flush
            >
              <div className="flex items-center gap-3 px-4 py-2 text-[13px] text-muted-foreground sm:px-6">
                <span className="flex-1" />
                <span className="w-14 text-center">Roadmap</span>
                <span className="w-7" />
              </div>
              <SettingsList className="border-t border-border/50">
                <SortableContext
                  items={categoryStatuses.map((s) => s.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {categoryStatuses.map((status) => (
                    <SortableStatusItem
                      key={status.id}
                      status={status}
                      canDelete={canDeleteInCategory}
                      onEdit={() => setEditingStatus(status)}
                      onToggleRoadmap={() => handleToggleRoadmap(status)}
                      onColorChange={(color) => handleColorChange(status, color)}
                      onDelete={() => setDeleteStatus(status)}
                    />
                  ))}
                </SortableContext>
              </SettingsList>
            </SettingsCard>
          )
        })}
      </DndContext>

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={!!deleteStatus}
        onOpenChange={() => setDeleteStatus(null)}
        title="Delete status?"
        description={`"${deleteStatus?.name}" will be removed. This cannot be undone.`}
        confirmLabel="Delete status"
        variant="destructive"
        onConfirm={handleDelete}
      />

      {/* Create status dialog */}
      <CreateStatusDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSubmit={handleCreate}
      />

      {/* Edit status dialog */}
      <EditStatusDialog
        open={!!editingStatus}
        onOpenChange={() => setEditingStatus(null)}
        status={editingStatus}
        onSubmit={async (data) => {
          if (!editingStatus) return
          try {
            await updateStatusFn({ data: { id: editingStatus.id, ...data } })
            setStatuses((prev) =>
              prev.map((s) => (s.id === editingStatus.id ? { ...s, ...data } : s))
            )
            setEditingStatus(null)
            startTransition(() => router.invalidate())
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Failed to update status')
          }
        }}
      />
    </SettingsPage>
  )
}

interface SortableStatusItemProps {
  status: PostStatusEntity
  canDelete: boolean
  onEdit: () => void
  onToggleRoadmap: () => void
  onColorChange: (color: string) => void
  onDelete: () => void
}

function SortableStatusItem({
  status,
  canDelete,
  onEdit,
  onToggleRoadmap,
  onColorChange,
  onDelete,
}: SortableStatusItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: status.id,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  // The default status and the last status in a category cannot be deleted; both show a lock.
  const locked = status.isDefault || !canDelete
  const actions = [
    { label: 'Edit', onSelect: onEdit },
    ...(status.isDefault
      ? []
      : [{ label: 'Delete', onSelect: onDelete, destructive: true, disabled: !canDelete }]),
  ]

  return (
    <div ref={setNodeRef} style={style}>
      <SettingsListRow
        grip={
          <button
            {...attributes}
            {...listeners}
            aria-label={`Reorder ${status.name}`}
            className="touch-none cursor-grab active:cursor-grabbing"
          >
            <Bars3Icon className="size-4 text-muted-foreground/70" />
          </button>
        }
        leading={
          <Popover>
            <PopoverTrigger asChild>
              <button
                aria-label={`Change colour of ${status.name}`}
                className="flex cursor-pointer rounded-full hover:ring-2 hover:ring-muted-foreground/40 hover:ring-offset-1"
              >
                <RowDot color={status.color} />
              </button>
            </PopoverTrigger>
            <PopoverContent className="w-auto p-2 space-y-2" align="start">
              <ColorPickerGrid selectedColor={status.color} onColorChange={onColorChange} />
              <ColorHexInput color={status.color} onColorChange={onColorChange} />
            </PopoverContent>
          </Popover>
        }
        title={
          <span className="inline-flex items-center gap-1.5">
            {status.name}
            {locked && (
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <LockClosedIcon aria-label="Locked" className="size-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>
                      {status.isDefault
                        ? 'Default status for new posts. It cannot be removed.'
                        : 'The last status in a category cannot be removed.'}
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </span>
        }
        actionsLabel={status.name}
        trailing={
          <span className="flex w-14 justify-center">
            <Switch
              checked={status.showOnRoadmap}
              onCheckedChange={onToggleRoadmap}
              aria-label={`Show ${status.name} on the roadmap`}
            />
          </span>
        }
        actions={actions}
      />
    </div>
  )
}

interface CreateStatusDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (data: {
    name: string
    slug: string
    color: string
    category: StatusCategory
  }) => Promise<void>
}

function CreateStatusDialog({ open, onOpenChange, onSubmit }: CreateStatusDialogProps) {
  const [category, setCategory] = useState<StatusCategory>('active')
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [color, setColor] = useState(() => randomColor())
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Reset with new random color when dialog opens
  useEffect(() => {
    if (open) {
      setName('')
      setSlug('')
      setCategory('active')
      setColor(randomColor())
    }
  }, [open])

  const handleNameChange = (value: string) => {
    setName(value)
    // Auto-generate slug from name
    setSlug(
      value
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name || !slug) return

    setIsSubmitting(true)
    try {
      await onSubmit({ name, slug, color, category })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New status</DialogTitle>
          <DialogDescription>Statuses group posts by where they stand.</DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              placeholder="e.g., In Review"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="status-category">Category</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as StatusCategory)}>
              <SelectTrigger id="status-category" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORY_ORDER.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CATEGORY_INFO[c].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="slug">Slug (for API)</Label>
            <Input
              id="slug"
              value={slug}
              onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
              placeholder="e.g., in_review"
              pattern="^[a-z0-9_]+$"
              required
            />
            <p className="text-xs text-muted-foreground">
              Lowercase letters, numbers, and underscores only
            </p>
          </div>

          <div className="space-y-2">
            <Label>Color</Label>
            <ColorPickerGrid selectedColor={color} onColorChange={setColor} />
            <ColorHexInput color={color} onColorChange={setColor} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || !name || !slug}>
              {isSubmitting ? 'Creating...' : 'Create status'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

interface EditStatusDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  status: PostStatusEntity | null
  onSubmit: (data: { name: string; color: string }) => Promise<void>
}

function EditStatusDialog({ open, onOpenChange, status, onSubmit }: EditStatusDialogProps) {
  const [name, setName] = useState('')
  const [color, setColor] = useState('#6b7280')
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (open && status) {
      setName(status.name)
      setColor(status.color)
    }
  }, [open, status])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    setIsSubmitting(true)
    try {
      await onSubmit({ name: name.trim(), color })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit status</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">Name</Label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., In Review"
              required
            />
          </div>

          <div className="space-y-2">
            <Label>Color</Label>
            <ColorPickerGrid selectedColor={color} onColorChange={setColor} />
            <ColorHexInput color={color} onColorChange={setColor} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || !name.trim()}>
              {isSubmitting ? 'Saving...' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
