# Help Center Category Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build admin UI for creating, editing, deleting, and reordering help center categories on the `/admin/help-center` page.

**Architecture:** Replace the filter sidebar with a category navigation sidebar (following the `UsersSegmentNav` pattern). Add a `CategoryFormDialog` for create/edit with emoji picker. Use `@dnd-kit/sortable` (already installed) for drag-to-reorder. Add inline category creation from the article editor. Move status filter to the list header.

**Tech Stack:** React, TanStack Router, TanStack Query, @dnd-kit/sortable, shadcn/ui (Dialog, Popover, Switch), Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-04-06-help-center-category-management-design.md`

---

### Task 1: CategoryFormDialog — create/edit dialog with emoji picker

This is the shared dialog used by the sidebar and the article editor. Build it first so it can be used in both places.

**Files:**

- Create: `apps/web/src/components/admin/help-center/category-form-dialog.tsx`

- [ ] **Step 1: Create the CategoryFormDialog component**

This dialog handles both create and edit modes. It includes an inline emoji picker using the same `Popover` pattern as the comment reaction picker.

```tsx
// apps/web/src/components/admin/help-center/category-form-dialog.tsx
import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useCreateCategory, useUpdateCategory } from '@/lib/client/mutations/help-center'
import type { HelpCenterCategoryId } from '@quackback/ids'

const CATEGORY_EMOJIS = [
  '📁',
  '📂',
  '📚',
  '📖',
  '📝',
  '📋',
  '📌',
  '📎',
  '💡',
  '⚡',
  '🔧',
  '🛠️',
  '⚙️',
  '🔑',
  '🔒',
  '🔓',
  '🚀',
  '🎯',
  '✅',
  '❓',
  '💬',
  '📣',
  '📢',
  '🔔',
  '💰',
  '💳',
  '🏷️',
  '📊',
  '📈',
  '🗂️',
  '🗃️',
  '📦',
  '🌐',
  '🔗',
  '🖥️',
  '📱',
  '🎨',
  '🧩',
  '🔍',
  '📡',
  '👤',
  '👥',
  '🏢',
  '🎓',
  '📅',
  '⏰',
  '🛡️',
  '🧪',
] as const

const DEFAULT_EMOJI = '📁'

interface CategoryFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** If provided, dialog is in edit mode */
  initialValues?: {
    id: HelpCenterCategoryId
    name: string
    description: string | null
    icon: string | null
    isPublic: boolean
  }
  /** Called after successful create with the new category id */
  onCreated?: (categoryId: string) => void
}

export function CategoryFormDialog({
  open,
  onOpenChange,
  initialValues,
  onCreated,
}: CategoryFormDialogProps) {
  const isEdit = !!initialValues
  const createCategory = useCreateCategory()
  const updateCategory = useUpdateCategory()

  const [icon, setIcon] = useState(DEFAULT_EMOJI)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isPublic, setIsPublic] = useState(true)
  const [emojiOpen, setEmojiOpen] = useState(false)

  // Reset form when dialog opens/closes or initialValues change
  useEffect(() => {
    if (open) {
      setIcon(initialValues?.icon || DEFAULT_EMOJI)
      setName(initialValues?.name || '')
      setDescription(initialValues?.description || '')
      setIsPublic(initialValues?.isPublic ?? true)
    }
  }, [open, initialValues])

  const isPending = createCategory.isPending || updateCategory.isPending

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    if (isEdit) {
      await updateCategory.mutateAsync({
        id: initialValues.id,
        name: name.trim(),
        description: description.trim() || null,
        icon,
        isPublic,
      })
    } else {
      const result = await createCategory.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        icon,
        isPublic,
      })
      onCreated?.(result.id)
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit category' : 'New category'}</DialogTitle>
          <DialogDescription>
            {isEdit ? 'Update category details.' : 'Create a new help center category.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Icon + Name row */}
          <div className="space-y-2">
            <Label htmlFor="category-name">Name</Label>
            <div className="flex items-center gap-2">
              <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="h-9 w-9 rounded-md border border-border/50 flex items-center justify-center text-lg hover:bg-muted transition-colors shrink-0"
                  >
                    {icon}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-2" align="start">
                  <div className="grid grid-cols-8 gap-1">
                    {CATEGORY_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        className="h-8 w-8 rounded-md hover:bg-muted flex items-center justify-center text-lg transition-colors"
                        onClick={() => {
                          setIcon(emoji)
                          setEmojiOpen(false)
                        }}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
              <Input
                id="category-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Getting Started"
                required
                className="flex-1"
              />
            </div>
          </div>

          {/* Description */}
          <div className="space-y-2">
            <Label htmlFor="category-description">Description</Label>
            <Input
              id="category-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional short description"
            />
          </div>

          {/* Public toggle */}
          <div className="flex items-center justify-between">
            <div>
              <Label>Public</Label>
              <p className="text-xs text-muted-foreground">Visible on your public help center</p>
            </div>
            <Switch checked={isPublic} onCheckedChange={setIsPublic} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !name.trim()}>
              {isPending ? (isEdit ? 'Saving...' : 'Creating...') : isEdit ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Verify it renders**

Run: `bun run typecheck`
Expected: No type errors in the new file.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/admin/help-center/category-form-dialog.tsx
git commit -m "feat(help-center): add CategoryFormDialog with emoji picker"
```

---

### Task 2: CategoryNav sidebar component

The main sidebar that lists categories with click-to-filter, hover actions, and drag-to-reorder. Follows the `UsersSegmentNav` pattern for hover actions and the `status-list.tsx` pattern for `@dnd-kit/sortable`.

**Files:**

- Create: `apps/web/src/components/admin/help-center/help-center-category-nav.tsx`

- [ ] **Step 1: Create the CategoryNav component**

```tsx
// apps/web/src/components/admin/help-center/help-center-category-nav.tsx
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
  selectedCategory?: string
  onSelectCategory: (categoryId: string | undefined) => void
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

    // Batch update positions
    for (let i = 0; i < reordered.length; i++) {
      if (reordered[i].position !== i) {
        await updateCategory.mutateAsync({ id: reordered[i].id, position: i })
      }
    }
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
    <div className="space-y-1">
      {/* Header */}
      <div className="flex items-center justify-between px-2 mb-1">
        <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Categories
        </span>
        <button
          type="button"
          onClick={() => setCreateOpen(true)}
          className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <PlusIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* All Articles */}
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

      <div className="border-t border-border/30 my-1" />

      {/* Category list */}
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
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={sortedCategories.map((c) => c.id)}
            strategy={verticalListSortingStrategy}
          >
            {sortedCategories.map((cat) => (
              <SortableCategoryItem
                key={cat.id}
                category={cat}
                isSelected={selectedCategory === cat.id}
                onSelect={() => onSelectCategory(selectedCategory === cat.id ? undefined : cat.id)}
                onEdit={() => setEditTarget(cat as CategoryItem)}
                onDelete={() => setDeleteTarget(cat as CategoryItem)}
              />
            ))}
          </SortableContext>
        </DndContext>
      )}

      {/* Create dialog */}
      <CategoryFormDialog open={createOpen} onOpenChange={setCreateOpen} />

      {/* Edit dialog */}
      <CategoryFormDialog
        open={!!editTarget}
        onOpenChange={(open) => !open && setEditTarget(null)}
        initialValues={editTarget ?? undefined}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete "${deleteTarget?.name}"?`}
        description={
          deleteTarget && deleteTarget.articleCount > 0
            ? `This category has ${deleteTarget.articleCount} article${deleteTarget.articleCount === 1 ? '' : 's'}. Reassign or delete them first.`
            : 'This will permanently delete the category.'
        }
        confirmLabel="Delete"
        variant="destructive"
        isPending={deleteCategory.isPending}
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
      {/* Drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="touch-none cursor-grab active:cursor-grabbing px-1 py-1.5 shrink-0"
      >
        <Bars3Icon className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity" />
      </button>

      {/* Main clickable area */}
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

      {/* Hover actions */}
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
```

- [ ] **Step 2: Verify it compiles**

Run: `bun run typecheck`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/admin/help-center/help-center-category-nav.tsx
git commit -m "feat(help-center): add CategoryNav sidebar with drag-to-reorder"
```

---

### Task 3: Integrate CategoryNav into the help center page

Replace the filter sidebar with the new CategoryNav and move the status filter to the list header using the existing `sortOptions` pattern on `AdminListHeader`.

**Files:**

- Modify: `apps/web/src/components/admin/help-center/help-center-list.tsx`

- [ ] **Step 1: Update HelpCenterList to use CategoryNav and inline status filter**

In `apps/web/src/components/admin/help-center/help-center-list.tsx`, make these changes:

1. Replace the `HelpCenterFiltersPanel` import with `HelpCenterCategoryNav`
2. Pass `CategoryNav` as the `filters` slot in `InboxLayout`
3. Add status sort pills to `AdminListHeader` using the existing `sortOptions` prop

Replace the imports at the top:

```tsx
// Remove this import:
import { HelpCenterFiltersPanel } from './help-center-filters'
// Add this import:
import { HelpCenterCategoryNav } from './help-center-category-nav'
```

Replace the `InboxLayout` `filters` prop (around line 128-136):

```tsx
<InboxLayout
  filters={
    <HelpCenterCategoryNav
      selectedCategory={filters.category}
      onSelectCategory={(category) => setFilters({ category })}
    />
  }
  hasActiveFilters={hasActiveFilters}
>
```

Add status filter pills to `AdminListHeader` (around line 140-144). Add the `sortOptions` and related props:

```tsx
<AdminListHeader
  searchValue={searchValue}
  onSearchChange={setSearchValue}
  sortOptions={[
    { value: 'all', label: 'All' },
    { value: 'draft', label: 'Draft' },
    { value: 'published', label: 'Published' },
  ]}
  activeSort={filters.status}
  onSortChange={(status) => setFilters({ status: status as HelpCenterStatusFilter })}
  action={<CreateArticleDialog />}
/>
```

Add the import for `HelpCenterStatusFilter`:

```tsx
import type { HelpCenterStatusFilter } from './use-help-center-filters'
```

- [ ] **Step 2: Verify it compiles and renders**

Run: `bun run typecheck`
Expected: No type errors.

Run: `bun run dev` and navigate to `/admin/help-center`
Expected: Left sidebar shows category nav with drag handles. Status pills appear above article list. Clicking a category filters articles.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/admin/help-center/help-center-list.tsx
git commit -m "feat(help-center): integrate CategoryNav sidebar and inline status filter"
```

---

### Task 4: Inline category creation from article editor

Add a "+" button next to the category dropdown in the article metadata sidebar. Opens `CategoryFormDialog` in create mode and auto-selects the new category.

**Files:**

- Modify: `apps/web/src/components/admin/help-center/help-center-metadata-sidebar.tsx`

- [ ] **Step 1: Add inline create button to the category dropdown**

In `apps/web/src/components/admin/help-center/help-center-metadata-sidebar.tsx`:

Add imports at the top:

```tsx
import { useState } from 'react'
import { PlusIcon } from '@heroicons/react/24/solid'
import { CategoryFormDialog } from './category-form-dialog'
```

In the `SidebarContent` function, add state for the create dialog:

```tsx
const [createCategoryOpen, setCreateCategoryOpen] = useState(false)
```

Replace the `SidebarRow` for Category (lines 40-53) with:

```tsx
<SidebarRow label="Category">
  <div className="flex items-center gap-1.5">
    <select
      value={categoryId || ''}
      onChange={(e) => onCategoryChange(e.target.value)}
      className="flex-1 text-sm bg-transparent border border-border/50 rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <option value="">Select category...</option>
      {categories?.map((cat) => (
        <option key={cat.id} value={cat.id}>
          {cat.icon ? `${cat.icon} ` : ''}
          {cat.name}
        </option>
      ))}
    </select>
    <button
      type="button"
      onClick={() => setCreateCategoryOpen(true)}
      className="h-7 w-7 flex items-center justify-center rounded-md border border-border/50 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors shrink-0"
      title="Create new category"
    >
      <PlusIcon className="h-3.5 w-3.5" />
    </button>
  </div>
  <CategoryFormDialog
    open={createCategoryOpen}
    onOpenChange={setCreateCategoryOpen}
    onCreated={(id) => onCategoryChange(id)}
  />
</SidebarRow>
```

- [ ] **Step 2: Verify it compiles**

Run: `bun run typecheck`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/admin/help-center/help-center-metadata-sidebar.tsx
git commit -m "feat(help-center): add inline category creation from article editor"
```

---

### Task 5: Also add inline creation to the CreateArticleDialog

The `CreateArticleDialog` has its own category dropdown that should also get the "+" button.

**Files:**

- Modify: `apps/web/src/components/admin/help-center/create-article-dialog.tsx`

- [ ] **Step 1: Check the create article dialog for its category dropdown**

Read `apps/web/src/components/admin/help-center/create-article-dialog.tsx` to find the category `<select>` element. It likely has a similar pattern to the metadata sidebar. Add the same inline "+" button and `CategoryFormDialog` integration.

Look for the category select element and wrap it in a flex container with a "+" button, the same way as Task 4. Import `useState`, `PlusIcon`, and `CategoryFormDialog`. Add a `createCategoryOpen` state. After creation, set the form's `categoryId` field to the new category's id using `form.setValue('categoryId', id)`.

- [ ] **Step 2: Verify it compiles**

Run: `bun run typecheck`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/admin/help-center/create-article-dialog.tsx
git commit -m "feat(help-center): add inline category creation to create article dialog"
```

---

### Task 6: Delete safety — block deletion when category has articles

The `ConfirmDialog` in the CategoryNav should disable the confirm button when the category has articles. The current `ConfirmDialog` component doesn't support a disabled confirm button natively, so we use a workaround.

**Files:**

- Modify: `apps/web/src/components/admin/help-center/help-center-category-nav.tsx`

- [ ] **Step 1: Update the delete confirmation to block when articles exist**

In `help-center-category-nav.tsx`, update the `handleDelete` function and `ConfirmDialog`:

The `ConfirmDialog` has an `onConfirm` prop. We can make `handleDelete` a no-op when articles exist, and update the description to explain why. Update the delete confirmation:

```tsx
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
```

By setting `isPending` to `true` when `articleCount > 0`, the confirm button is disabled (the `ConfirmDialog` disables the button when `isPending` is true). This leverages existing behavior without modifying the shared component.

- [ ] **Step 2: Verify it compiles**

Run: `bun run typecheck`
Expected: No type errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/admin/help-center/help-center-category-nav.tsx
git commit -m "fix(help-center): block category deletion when it contains articles"
```

---

### Task 7: Manual testing and cleanup

- [ ] **Step 1: Run full type check and lint**

Run: `bun run typecheck && bun run lint`
Expected: No errors.

- [ ] **Step 2: Manual test the full flow**

Run: `bun run dev` and test:

1. Navigate to `/admin/help-center`
2. Verify category sidebar appears on the left with "Categories" header and "+" button
3. Click "+" — verify create dialog opens with emoji picker, name, description, public toggle
4. Create a category — verify it appears in the sidebar with correct emoji and count (0)
5. Click the category — verify article list filters to show only that category's articles
6. Click "All Articles" — verify filter clears
7. Hover a category — verify edit (pencil) and delete (trash) icons appear, count hides
8. Click edit — verify dialog opens pre-filled, save updates the category
9. Drag a category — verify reorder works and persists on refresh
10. Status pills (All/Draft/Published) appear above article list and filter correctly
11. Open an article editor — verify "+" button next to category dropdown
12. Click "+" in article editor — verify create dialog, new category auto-selected
13. Create a new article — verify "+" button in create dialog also works
14. Try to delete a category with articles — verify confirm button is disabled with explanation

- [ ] **Step 3: Commit any fixes**

```bash
git add -u
git commit -m "fix(help-center): polish category management UI"
```
