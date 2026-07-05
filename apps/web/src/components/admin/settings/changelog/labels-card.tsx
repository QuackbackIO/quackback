import { useState, useEffect, useTransition } from 'react'
import { useRouter } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  PlusIcon,
  TrashIcon,
  PencilSquareIcon,
  ArrowPathIcon,
  ChevronUpIcon,
  ChevronDownIcon,
} from '@heroicons/react/24/solid'
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
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { SegmentMultiSelect } from '@/components/admin/segments/segment-multi-select'
import { cn } from '@/lib/shared/utils'
import { listSegmentsFn } from '@/lib/server/functions/admin'
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
      setError(err instanceof Error ? err.message : 'Failed to save category')
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit category' : 'New category'}</DialogTitle>
        </DialogHeader>

        <div className="flex justify-center py-3 bg-muted/30 rounded-lg">
          <span
            className="inline-flex items-center px-3 py-0.5 rounded-md text-sm font-medium"
            style={{ backgroundColor: color + '20', color }}
          >
            {name.trim() || 'Category name'}
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
            {isSaving ? 'Saving...' : isEdit ? 'Save changes' : 'Create category'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  const [reordering, setReordering] = useState(false)

  const segmentsQuery = useQuery({
    queryKey: ['admin', 'segments'] as const,
    queryFn: () => listSegmentsFn(),
    staleTime: 60_000,
  })
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
      toast.error(error instanceof Error ? error.message : 'Failed to delete category')
    } finally {
      setDeletingCategory(null)
    }
  }

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction
    if (target < 0 || target >= categories.length) return
    const next = [...categories]
    ;[next[index], next[target]] = [next[target], next[index]]
    setCategories(next)
    setReordering(true)
    try {
      await reorderChangelogCategoriesFn({ data: { ids: next.map((c) => c.id) } })
      startTransition(() => router.invalidate())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to reorder categories')
      setCategories(categories)
    } finally {
      setReordering(false)
    }
  }

  return (
    <div className="space-y-8">
      <SettingsCard
        title="Labels"
        description="Categorize changelog entries. Gate a label to specific segments to show it only to the customers it applies to."
        contentClassName="p-4"
      >
        <div className="space-y-1">
          {categories.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No labels yet. Create your first label to get started.
            </p>
          )}

          {categories.map((category, index) => (
            <div
              key={category.id}
              className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50 group"
            >
              <div className="flex flex-col -my-1">
                <button
                  type="button"
                  className="text-muted-foreground/50 hover:text-muted-foreground disabled:opacity-30"
                  onClick={() => move(index, -1)}
                  disabled={index === 0 || reordering}
                  aria-label={`Move ${category.name} up`}
                >
                  <ChevronUpIcon className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  className="text-muted-foreground/50 hover:text-muted-foreground disabled:opacity-30"
                  onClick={() => move(index, 1)}
                  disabled={index === categories.length - 1 || reordering}
                  aria-label={`Move ${category.name} down`}
                >
                  <ChevronDownIcon className="h-3 w-3" />
                </button>
              </div>

              <span
                className="h-3 w-3 rounded-full shrink-0"
                style={{ backgroundColor: category.color }}
              />

              <span className="text-sm font-medium">{category.name}</span>

              {category.segmentIds.length > 0 && (
                <Popover>
                  <PopoverTrigger asChild>
                    <button className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full hover:bg-muted/70">
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
              )}

              <span className="flex-1" />

              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground opacity-0 group-hover:opacity-100"
                onClick={() => openEdit(category)}
                title="Edit label"
              >
                <PencilSquareIcon className="h-3.5 w-3.5" />
              </Button>

              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100"
                onClick={() => setDeletingCategory(category)}
                title="Delete label"
              >
                <TrashIcon className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}

          <button
            className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50 w-full text-muted-foreground"
            onClick={openCreate}
          >
            <PlusIcon className="h-3 w-3" />
            <span className="text-sm">Add new label</span>
            {reordering && <ArrowPathIcon className="h-3 w-3 animate-spin ms-1" />}
          </button>
        </div>
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
        title="Delete label"
        description={`Are you sure you want to delete "${deletingCategory?.name}"? This will remove it from every changelog entry.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  )
}
