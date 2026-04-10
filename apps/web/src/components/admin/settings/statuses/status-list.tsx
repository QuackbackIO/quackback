import { useState, useEffect, useTransition } from 'react'
import { useRouter } from '@tanstack/react-router'
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
import {
  PlusIcon,
  Bars3Icon,
  TrashIcon,
  LockClosedIcon,
  ArrowPathIcon,
  PencilSquareIcon,
} from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { Input } from '@/components/ui/input'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { PostStatusEntity, StatusCategory } from '@/lib/shared/db-types'
import { cn } from '@/lib/shared/utils'
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
  active: {
    label: 'Active',
    description:
      'Statuses for posts that are being worked on or need attention. These represent different stages of progress before completion.',
  },
  complete: {
    label: 'Complete',
    description:
      'Final statuses for posts that have been successfully addressed. Completed posts are deprioritized when suggesting similar posts to avoid duplicates.',
  },
  closed: {
    label: 'Closed',
    description:
      "Statuses for posts that won't be implemented. Use these for declined requests, duplicates, or items that are out of scope. Closed posts are deprioritized when suggesting similar posts.",
  },
}

const CATEGORY_ORDER: StatusCategory[] = ['active', 'complete', 'closed']

const PRESET_COLORS = [
  // Row 1 - Vibrant
  '#ef4444', // Red
  '#f97316', // Orange
  '#eab308', // Yellow
  '#22c55e', // Green
  '#14b8a6', // Teal
  '#3b82f6', // Blue
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  // Row 2 - Muted
  '#f87171', // Light Red
  '#fb923c', // Light Orange
  '#facc15', // Light Yellow
  '#4ade80', // Light Green
  '#2dd4bf', // Light Teal
  '#60a5fa', // Light Blue
  '#a78bfa', // Light Violet
  '#f472b6', // Light Pink
  // Row 3 - Dark
  '#b91c1c', // Dark Red
  '#c2410c', // Dark Orange
  '#a16207', // Dark Yellow
  '#15803d', // Dark Green
  '#0f766e', // Dark Teal
  '#1d4ed8', // Dark Blue
  '#6d28d9', // Dark Violet
  '#be185d', // Dark Pink
  // Row 4 - Neutrals
  '#0f172a', // Slate 900
  '#334155', // Slate 700
  '#64748b', // Slate 500
  '#94a3b8', // Slate 400
  '#475569', // Slate 600
  '#1e293b', // Slate 800
  '#78716c', // Stone 500
  '#a8a29e', // Stone 400
]

function randomColor(): string {
  return (
    '#' +
    Math.floor(Math.random() * 0xffffff)
      .toString(16)
      .padStart(6, '0')
  )
}

interface ColorPickerGridProps {
  selectedColor: string
  onColorChange: (color: string) => void
}

function ColorPickerGrid({
  selectedColor,
  onColorChange,
}: ColorPickerGridProps): React.ReactElement {
  return (
    <div className="grid grid-cols-8 gap-1.5">
      {PRESET_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          className={cn(
            'h-6 w-6 rounded-full border-2 transition-colors',
            selectedColor.toLowerCase() === c.toLowerCase()
              ? 'border-foreground'
              : 'border-transparent'
          )}
          style={{ backgroundColor: c }}
          onClick={() => onColorChange(c)}
        />
      ))}
    </div>
  )
}

function ColorHexInput({
  color,
  onColorChange,
}: {
  color: string
  onColorChange: (color: string) => void
}) {
  const [hexInput, setHexInput] = useState(color)

  // Sync when color changes externally (preset click)
  useEffect(() => {
    setHexInput(color)
  }, [color])

  function handleHexChange(value: string) {
    setHexInput(value)
    if (/^#[0-9A-Fa-f]{6}$/.test(value)) {
      onColorChange(value)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span
        className="h-6 w-6 rounded-md border border-border shrink-0"
        style={{ backgroundColor: color }}
      />
      <Input
        value={hexInput}
        onChange={(e) => handleHexChange(e.target.value)}
        className="font-mono text-xs h-7"
        placeholder="#000000"
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={() => {
          const c = randomColor()
          setHexInput(c)
          onColorChange(c)
        }}
        title="Random color"
      >
        <ArrowPathIcon className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

export function StatusList({ initialStatuses }: StatusListProps) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [statuses, setStatuses] = useState(initialStatuses)
  const [savingField, setSavingField] = useState<string | null>(null)
  const [editingStatus, setEditingStatus] = useState<PostStatusEntity | null>(null)
  const [deleteStatus, setDeleteStatus] = useState<PostStatusEntity | null>(null)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [createCategory, setCreateCategory] = useState<StatusCategory>('active')

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

  // Handle drag end — reorder and save immediately
  const handleDragEnd = async (event: DragEndEvent) => {
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

    try {
      await reorderStatusesFn({
        data: { statusIds: reorderedCategory.map((s) => s.id) },
      })
      startTransition(() => router.invalidate())
    } catch {
      toast.error('Failed to reorder statuses')
      setStatuses(initialStatuses)
    }
  }

  // Toggle roadmap — save immediately
  const handleToggleRoadmap = async (status: PostStatusEntity) => {
    const newValue = !status.showOnRoadmap
    setSavingField(`roadmap-${status.id}`)
    setStatuses((prev) =>
      prev.map((s) => (s.id === status.id ? { ...s, showOnRoadmap: newValue } : s))
    )

    try {
      await updateStatusFn({
        data: { id: status.id, showOnRoadmap: newValue },
      })
      startTransition(() => router.invalidate())
    } catch {
      toast.error('Failed to update roadmap visibility')
      setStatuses((prev) =>
        prev.map((s) => (s.id === status.id ? { ...s, showOnRoadmap: !newValue } : s))
      )
    } finally {
      setSavingField(null)
    }
  }

  // Change color — save immediately
  const handleColorChange = async (status: PostStatusEntity, color: string) => {
    const previousColor = status.color
    setSavingField(`color-${status.id}`)
    setStatuses((prev) => prev.map((s) => (s.id === status.id ? { ...s, color } : s)))

    try {
      await updateStatusFn({
        data: { id: status.id, color },
      })
      startTransition(() => router.invalidate())
    } catch {
      toast.error('Failed to update color')
      setStatuses((prev) =>
        prev.map((s) => (s.id === status.id ? { ...s, color: previousColor } : s))
      )
    } finally {
      setSavingField(null)
    }
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

  const roadmapCount = statuses.filter((s) => s.showOnRoadmap).length

  return (
    <div className="space-y-8">
      {/* Roadmap info */}
      <div className="flex items-center justify-end gap-3">
        <p className="text-sm text-muted-foreground">Toggle statuses to show on your roadmap</p>
        <Badge variant="outline">{roadmapCount} selected</Badge>
      </div>

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
              contentClassName="p-4"
            >
              <div className="space-y-1">
                <SortableContext
                  items={categoryStatuses.map((s) => s.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {categoryStatuses.map((status) => (
                    <SortableStatusItem
                      key={status.id}
                      status={status}
                      canDelete={canDeleteInCategory && !status.isDefault}
                      savingField={savingField}
                      onEdit={() => setEditingStatus(status)}
                      onToggleRoadmap={() => handleToggleRoadmap(status)}
                      onColorChange={(color) => handleColorChange(status, color)}
                      onDelete={() => setDeleteStatus(status)}
                    />
                  ))}
                </SortableContext>

                <button
                  className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50 w-full text-muted-foreground"
                  onClick={() => {
                    setCreateCategory(category)
                    setCreateDialogOpen(true)
                  }}
                >
                  {/* Spacer for grip handle alignment */}
                  <div className="w-3.5" />
                  <PlusIcon className="h-3 w-3" />
                  <span className="text-sm">Add new status</span>
                </button>
              </div>
            </SettingsCard>
          )
        })}
      </DndContext>

      {/* Delete confirmation dialog */}
      <ConfirmDialog
        open={!!deleteStatus}
        onOpenChange={() => setDeleteStatus(null)}
        title="Delete status"
        description={`Are you sure you want to delete "${deleteStatus?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
      />

      {/* Create status dialog */}
      <CreateStatusDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        category={createCategory}
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
    </div>
  )
}

interface SortableStatusItemProps {
  status: PostStatusEntity
  canDelete: boolean
  savingField: string | null
  onEdit: () => void
  onToggleRoadmap: () => void
  onColorChange: (color: string) => void
  onDelete: () => void
}

function SortableStatusItem({
  status,
  canDelete,
  savingField,
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

  function getDeleteTitle(): string {
    if (status.isDefault) return 'Cannot delete the default status'
    if (!canDelete) return 'Must have at least one status in each category'
    return 'Delete status'
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50 group"
    >
      <button
        {...attributes}
        {...listeners}
        className="touch-none cursor-grab active:cursor-grabbing"
      >
        <Bars3Icon className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
      </button>

      <Popover>
        <PopoverTrigger asChild>
          <button
            className="h-3 w-3 rounded-full shrink-0 cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-muted-foreground/50"
            style={{ backgroundColor: status.color }}
          />
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2 space-y-2" align="start">
          <ColorPickerGrid selectedColor={status.color} onColorChange={onColorChange} />
          <ColorHexInput color={status.color} onColorChange={onColorChange} />
        </PopoverContent>
      </Popover>

      <span className="text-sm flex-1 flex items-center gap-1.5">
        {status.name}
        {status.isDefault && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <LockClosedIcon className="h-3 w-3 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                <p>Default status for new posts and cannot be removed</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </span>

      {/* Edit button */}
      <Button
        variant="ghost"
        size="icon"
        className="h-7 w-7 text-muted-foreground opacity-0 group-hover:opacity-100"
        onClick={onEdit}
        title="Edit status"
      >
        <PencilSquareIcon className="h-3.5 w-3.5" />
      </Button>

      {/* Roadmap toggle */}
      {(savingField === `roadmap-${status.id}` || savingField === `color-${status.id}`) && (
        <ArrowPathIcon className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
      )}
      <Switch
        checked={status.showOnRoadmap}
        onCheckedChange={onToggleRoadmap}
        className="scale-90"
      />

      {/* Delete button */}
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          'h-7 w-7 text-muted-foreground hover:text-destructive',
          !canDelete && 'opacity-50 cursor-not-allowed'
        )}
        onClick={onDelete}
        disabled={!canDelete}
        title={getDeleteTitle()}
      >
        <TrashIcon className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

interface CreateStatusDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  category: StatusCategory
  onSubmit: (data: {
    name: string
    slug: string
    color: string
    category: StatusCategory
  }) => Promise<void>
}

function CreateStatusDialog({ open, onOpenChange, category, onSubmit }: CreateStatusDialogProps) {
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [color, setColor] = useState(() => randomColor())
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Reset with new random color when dialog opens
  useEffect(() => {
    if (open) {
      setName('')
      setSlug('')
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
          <DialogTitle>Add new status</DialogTitle>
          <DialogDescription>
            Create a new status in the {CATEGORY_INFO[category].label.toLowerCase()} category.
          </DialogDescription>
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
