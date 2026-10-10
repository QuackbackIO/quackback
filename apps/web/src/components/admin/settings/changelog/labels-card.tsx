import { useState, useEffect, useTransition } from 'react'
import { useRouter } from '@tanstack/react-router'
import { useMutation, useQuery } from '@tanstack/react-query'
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
import { Bars3Icon, TagIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { EmptyState } from '@/components/shared/empty-state'
import { NewButton } from '@/components/shared/new-button'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { RowDot, SettingsList, SettingsListRow } from '@/components/admin/settings/settings-list'
import { AUTOSAVE } from '@/lib/client/autosave'
import { SegmentMultiSelect } from '@/components/admin/segments/segment-multi-select'
import { cn } from '@/lib/shared/utils'
import { changelogCategoryQueries } from '@/lib/client/queries/changelog'
import {
  createChangelogCategoryFn,
  updateChangelogCategoryFn,
  deleteChangelogCategoryFn,
  reorderChangelogCategoriesFn,
} from '@/lib/server/functions/changelog-categories'
import type { ChangelogCategory } from '@/lib/server/domains/changelog/changelog-category.types'

const PRESET_COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#64748b',
  '#0f172a',
]

function randomColor(): string {
  return PRESET_COLORS[Math.floor(Math.random() * PRESET_COLORS.length)]
}

function ColorPickerGrid({
  selectedColor,
  onColorChange,
}: {
  selectedColor: string
  onColorChange: (color: string) => void
}) {
  return (
    <div className="grid grid-cols-5 gap-1.5">
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

interface CategoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  category: ChangelogCategory | null
  segments: { id: string; name: string }[]
  onSaved: (saved: ChangelogCategory) => void
}

function CategoryDialog({ open, onOpenChange, category, segments, onSaved }: CategoryDialogProps) {
  const [name, setName] = useState('')
  const [color, setColor] = useState('#6b7280')
  const [segmentIds, setSegmentIds] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const isEdit = category !== null

  useEffect(() => {
    if (open) {
      if (category) {
        setName(category.name)
        setColor(category.color)
        setSegmentIds(category.segmentIds)
      } else {
        setName('')
        setColor(randomColor())
        setSegmentIds([])
      }
      setError(null)
    }
  }, [open, category])

  async function handleSave() {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('Name is required')
      return
    }

    setIsSaving(true)
    setError(null)

    try {
      let saved: ChangelogCategory
      if (isEdit) {
        saved = await updateChangelogCategoryFn({
          data: { id: category.id, name: trimmedName, color, segmentIds },
        })
      } else {
        saved = await createChangelogCategoryFn({
          data: { name: trimmedName, color, segmentIds },
        })
      }
      onSaved(saved)
      onOpenChange(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save label')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit label' : 'Create label'}</DialogTitle>
        </DialogHeader>

        <div className="flex justify-center py-3 bg-muted/30 rounded-lg">
          <span
            className="inline-flex items-center px-3 py-0.5 rounded-md text-sm font-medium"
            style={{ backgroundColor: color + '20', color }}
          >
            {name.trim() || 'Label name'}
          </span>
        </div>

        <div className="space-y-2">
          <Label htmlFor="category-name">Name</Label>
          <Input
            id="category-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. New, Improved, Fixed"
            maxLength={50}
          />
        </div>

        <div className="space-y-2">
          <Label>Color</Label>
          <ColorPickerGrid selectedColor={color} onColorChange={setColor} />
        </div>

        {segments.length > 0 && (
          <div className="space-y-2">
            <Label>
              Restrict to segments{' '}
              <span className="text-muted-foreground font-normal">(optional)</span>
            </Label>
            <p className="text-xs text-muted-foreground">
              Leave empty to show this category to everyone.
            </p>
            <SegmentMultiSelect
              segments={segments}
              value={segmentIds}
              onChange={setSegmentIds}
              ariaLabel="Category segment gate"
            />
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : isEdit ? 'Save changes' : 'Create label'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SortableLabelRow({
  category,
  segments,
  onEdit,
  onDelete,
}: {
  category: ChangelogCategory
  segments: { id: string; name: string }[]
  onEdit: () => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: category.id,
  })
  const gated = category.segmentIds.length > 0

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
      }}
    >
      <SettingsListRow
        grip={
          <button
            {...attributes}
            {...listeners}
            aria-label={`Reorder ${category.name}`}
            className="touch-none cursor-grab active:cursor-grabbing"
          >
            <Bars3Icon className="size-4 text-muted-foreground/70" />
          </button>
        }
        leading={<RowDot color={category.color} />}
        title={category.name}
        badges={
          gated && (
            <Popover>
              <PopoverTrigger asChild>
                <button className="rounded-full bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted/70">
                  {category.segmentIds.length} segment
                  {category.segmentIds.length === 1 ? '' : 's'}
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-64 text-xs" align="start">
                Only visible to members of{' '}
                {category.segmentIds
                  .map((id) => segments.find((s) => s.id === id)?.name ?? id)
                  .join(', ')}
                .
              </PopoverContent>
            </Popover>
          )
        }
        actions={[
          { label: 'Edit', onSelect: onEdit },
          { label: 'Delete', onSelect: onDelete, destructive: true },
        ]}
      />
    </div>
  )
}

interface LabelsCardProps {
  initialCategories: ChangelogCategory[]
}

export function LabelsCard({ initialCategories }: LabelsCardProps) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [categories, setCategories] = useState(initialCategories)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<ChangelogCategory | null>(null)
  const [deletingCategory, setDeletingCategory] = useState<ChangelogCategory | null>(null)

  const segmentsQuery = useQuery(changelogCategoryQueries.segments())
  const segments = (segmentsQuery.data ?? []).map((s) => ({ id: s.id, name: s.name }))

  function handleCategorySaved(saved: ChangelogCategory) {
    if (editingCategory) {
      setCategories((prev) => prev.map((c) => (c.id === saved.id ? saved : c)))
    } else {
      setCategories((prev) => [...prev, saved])
    }
    startTransition(() => router.invalidate())
  }

  function openCreate() {
    setEditingCategory(null)
    setDialogOpen(true)
  }

  function openEdit(category: ChangelogCategory) {
    setEditingCategory(category)
    setDialogOpen(true)
  }

  async function handleDelete() {
    if (!deletingCategory) return
    try {
      await deleteChangelogCategoryFn({ data: { id: deletingCategory.id } })
      setCategories((prev) => prev.filter((c) => c.id !== deletingCategory.id))
      startTransition(() => router.invalidate())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete label')
    } finally {
      setDeletingCategory(null)
    }
  }

  // A reorder saves on drop. A failure restores the previous order; the
  // autosave handler shows the one toast.
  const reorderMutation = useMutation({
    mutationFn: (ids: string[]) => reorderChangelogCategoriesFn({ data: { ids } }),
    meta: AUTOSAVE,
    onSuccess: () => startTransition(() => router.invalidate()),
    onError: (_error, _ids, previous) => setCategories(previous ?? initialCategories),
    onMutate: () => categories,
  })

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = categories.findIndex((c) => c.id === active.id)
    const newIndex = categories.findIndex((c) => c.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return
    const next = arrayMove(categories, oldIndex, newIndex)
    setCategories(next)
    reorderMutation.mutate(next.map((c) => c.id))
  }

  return (
    <>
      <SettingsCard
        title="Labels"
        description="Group entries by label."
        action={<NewButton noun="label" onClick={openCreate} />}
        flush
      >
        {categories.length === 0 ? (
          <EmptyState icon={TagIcon} title="No labels yet" size="compact" />
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleDragEnd}
          >
            <SettingsList>
              <SortableContext
                items={categories.map((c) => c.id)}
                strategy={verticalListSortingStrategy}
              >
                {categories.map((category) => (
                  <SortableLabelRow
                    key={category.id}
                    category={category}
                    segments={segments}
                    onEdit={() => openEdit(category)}
                    onDelete={() => setDeletingCategory(category)}
                  />
                ))}
              </SortableContext>
            </SettingsList>
          </DndContext>
        )}
      </SettingsCard>

      <CategoryDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        category={editingCategory}
        segments={segments}
        onSaved={handleCategorySaved}
      />

      <ConfirmDialog
        open={!!deletingCategory}
        onOpenChange={() => setDeletingCategory(null)}
        title="Delete label?"
        description={`Delete "${deletingCategory?.name}"? This removes it from every changelog entry.`}
        confirmLabel="Delete label"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </>
  )
}
