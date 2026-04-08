import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
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
import { PlusIcon, Bars3Icon, PencilIcon, TrashIcon, FolderIcon } from '@heroicons/react/24/solid'
import { helpCenterQueries } from '@/lib/client/queries/help-center'
import { useUpdateCategory, useDeleteCategory } from '@/lib/client/mutations/help-center'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { CategoryFormDialog } from './category-form-dialog'
import { cn } from '@/lib/shared/utils'
import type { HelpCenterCategoryId } from '@quackback/ids'

interface HelpCenterCategoryNavProps {
  selectedCategory?: HelpCenterCategoryId
  onSelectCategory: (categoryId: HelpCenterCategoryId | undefined) => void
}

interface CategoryItem {
  id: HelpCenterCategoryId
  name: string
  description: string | null
  icon: string | null
  isPublic: boolean
  position: number
  articleCount: number
}

export function HelpCenterCategoryNav({
  selectedCategory,
  onSelectCategory,
}: HelpCenterCategoryNavProps) {
  const { data: categories, isLoading } = useQuery(helpCenterQueries.categories())
  const updateCategory = useUpdateCategory()
  const deleteCategory = useDeleteCategory()

  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<CategoryItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<CategoryItem | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const sortedCategories = (categories ?? []).slice().sort((a, b) => a.position - b.position)
  const totalArticles = sortedCategories.reduce((sum, c) => sum + c.articleCount, 0)

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = sortedCategories.findIndex((c) => c.id === active.id)
    const newIndex = sortedCategories.findIndex((c) => c.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const reordered = arrayMove(sortedCategories, oldIndex, newIndex)

    const updates = reordered
      .map((cat, i) => (cat.position !== i ? { id: cat.id, position: i } : null))
      .filter(Boolean)

    await Promise.all(updates.map((u) => updateCategory.mutateAsync(u!)))
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    await deleteCategory.mutateAsync(deleteTarget.id)
    if (selectedCategory === deleteTarget.id) {
      onSelectCategory(undefined)
    }
    setDeleteTarget(null)
  }

  return (
    <div className="space-y-0">
      <div className="pb-4 last:pb-0">
        <div className="flex w-full items-center justify-between py-1">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Categories
          </span>
          <button
            type="button"
            onClick={() => setCreateOpen(true)}
            className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <PlusIcon className="h-3 w-3" />
          </button>
        </div>

        <div className="mt-2 space-y-1">
          <button
            type="button"
            onClick={() => onSelectCategory(undefined)}
            className={cn(
              'w-full text-left px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors flex items-center justify-between',
              !selectedCategory
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
            )}
          >
            <span className="flex items-center gap-2">
              <FolderIcon className="h-3.5 w-3.5" />
              All Articles
            </span>
            <span className="text-muted-foreground/50 text-[10px]">{totalArticles}</span>
          </button>

          {isLoading ? (
            <div className="space-y-1 px-1">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-7 rounded-md bg-muted/50 animate-pulse" />
              ))}
            </div>
          ) : sortedCategories.length === 0 ? (
            <p className="text-xs text-muted-foreground px-2.5 py-2">
              No categories yet. Click + to create one.
            </p>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={sortedCategories.map((c) => c.id)}
                strategy={verticalListSortingStrategy}
              >
                {sortedCategories.map((cat) => (
                  <SortableCategoryItem
                    key={cat.id}
                    category={cat as CategoryItem}
                    isSelected={selectedCategory === cat.id}
                    onSelect={() =>
                      onSelectCategory(selectedCategory === cat.id ? undefined : cat.id)
                    }
                    onEdit={() => setEditTarget(cat as CategoryItem)}
                    onDelete={() => setDeleteTarget(cat as CategoryItem)}
                  />
                ))}
              </SortableContext>
            </DndContext>
          )}
        </div>
      </div>

      <CategoryFormDialog open={createOpen} onOpenChange={setCreateOpen} />

      <CategoryFormDialog
        open={!!editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        initialValues={editTarget ?? undefined}
      />

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete "${deleteTarget?.name}"?`}
        description={
          deleteTarget && deleteTarget.articleCount > 0
            ? `This category has ${deleteTarget.articleCount} article${deleteTarget.articleCount === 1 ? '' : 's'}. Move or delete the articles first before removing this category.`
            : 'This will permanently delete the category.'
        }
        confirmLabel="Delete"
        variant="destructive"
        isPending={deleteCategory.isPending || (deleteTarget?.articleCount ?? 0) > 0}
        onConfirm={handleDelete}
      />
    </div>
  )
}

interface SortableCategoryItemProps {
  category: CategoryItem
  isSelected: boolean
  onSelect: () => void
  onEdit: () => void
  onDelete: () => void
}

function SortableCategoryItem({
  category,
  isSelected,
  onSelect,
  onEdit,
  onDelete,
}: SortableCategoryItemProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: category.id,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group flex items-center rounded-md transition-colors',
        isSelected
          ? 'bg-muted text-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
      )}
    >
      <button
        {...attributes}
        {...listeners}
        className="touch-none cursor-grab active:cursor-grabbing px-1 py-1.5 shrink-0"
      >
        <Bars3Icon className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
      </button>

      <button
        type="button"
        onClick={onSelect}
        className="flex-1 text-left py-1.5 pr-1 text-xs font-medium flex items-center gap-1.5 min-w-0"
      >
        <span className="shrink-0">{category.icon || '📁'}</span>
        <span className="truncate">{category.name}</span>
        <span className="text-muted-foreground/50 text-[10px] shrink-0 group-hover:hidden">
          {category.articleCount}
        </span>
      </button>

      <div className="hidden group-hover:flex items-center shrink-0 pr-1">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onEdit()
          }}
          className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors"
        >
          <PencilIcon className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-destructive transition-colors"
        >
          <TrashIcon className="h-3 w-3" />
        </button>
      </div>
    </div>
  )
}
