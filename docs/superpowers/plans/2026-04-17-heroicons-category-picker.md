# Heroicons Category Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the emoji picker for help-center category icons with a searchable Heroicons solid icon picker, storing the icon export name (e.g. `"FolderIcon"`) in the existing `icon text` column.

**Architecture:** A shared `<CategoryIcon>` component resolves a stored icon key via namespace import of `@heroicons/react/20/solid` and falls back to `FolderIcon`. The picker in `category-form-dialog.tsx` replaces the emoji grid with a search-filtered scrollable grid of all ~300 solid icons. All render sites swap inline emoji rendering for `<CategoryIcon>`.

**Tech Stack:** `@heroicons/react` v2.2.0 (already installed), React, shadcn/ui Popover + Input, Tailwind v4.

---

## File Map

**Create:**

- `apps/web/src/components/help-center/category-icon.tsx` — resolves a stored icon key to a Heroicons component with FolderIcon fallback

**Modify:**

- `apps/web/src/components/admin/help-center/category-form-dialog.tsx` — replace emoji picker with Heroicons picker
- `apps/web/src/components/help-center/help-center-category-grid.tsx` — use CategoryIcon
- `apps/web/src/components/admin/help-center/help-center-category-tree.tsx` — use CategoryIcon
- `apps/web/src/components/admin/help-center/help-center-finder.tsx` — use CategoryIcon (2 sites)
- `apps/web/src/components/admin/help-center/help-center-metadata-sidebar.tsx` — use CategoryIcon
- `apps/web/src/components/admin/help-center/help-center-article-editor.tsx` — use CategoryIcon (2 sites)
- `apps/web/src/components/widget/widget-help.tsx` — use CategoryIcon
- `apps/web/src/components/widget/widget-help-category.tsx` — use CategoryIcon
- `apps/web/src/routes/_portal/hc/categories/$categorySlug/index.tsx` — use CategoryIcon (2 sites)

---

### Task 1: Create `<CategoryIcon>` component

**Files:**

- Create: `apps/web/src/components/help-center/category-icon.tsx`

- [ ] **Step 1: Create the file**

Create `apps/web/src/components/help-center/category-icon.tsx`:

```tsx
import * as SolidIcons from '@heroicons/react/20/solid'
import type { ComponentType, SVGProps } from 'react'

type HeroIcon = ComponentType<SVGProps<SVGSVGElement>>
const ICON_LOOKUP = SolidIcons as Record<string, HeroIcon>

interface CategoryIconProps {
  icon: string | null
  className?: string
}

export function CategoryIcon({ icon, className }: CategoryIconProps) {
  const Icon = (icon ? ICON_LOOKUP[icon] : null) ?? SolidIcons.FolderIcon
  return <Icon className={className} />
}
```

- [ ] **Step 2: Verify it typechecks**

```bash
cd apps/web && bun run typecheck 2>&1 | grep category-icon
```

Expected: no output (no errors)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/help-center/category-icon.tsx
git commit -m "feat(help-center): add CategoryIcon component for heroicons lookup"
```

---

### Task 2: Replace emoji picker with Heroicons picker

**Files:**

- Modify: `apps/web/src/components/admin/help-center/category-form-dialog.tsx`

- [ ] **Step 1: Replace the entire file**

Write `apps/web/src/components/admin/help-center/category-form-dialog.tsx`:

```tsx
import { useState, useEffect, useMemo } from 'react'
import * as SolidIcons from '@heroicons/react/20/solid'
import type { ComponentType, SVGProps } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { CategoryIcon } from '@/components/help-center/category-icon'
import { cn } from '@/lib/shared/utils'
import { useCreateCategory, useUpdateCategory } from '@/lib/client/mutations/help-center'
import { helpCenterQueries } from '@/lib/client/queries/help-center'
import {
  MAX_CATEGORY_DEPTH,
  collectDescendantIdsIncludingSelf,
  getCategoryDepth,
  getSubtreeMaxDepth,
} from '@/lib/server/domains/help-center/category-tree'
import type { HelpCenterCategoryId } from '@quackback/ids'

const DEFAULT_ICON = 'FolderIcon'

type HeroIcon = ComponentType<SVGProps<SVGSVGElement>>
const ICON_LOOKUP = SolidIcons as Record<string, HeroIcon>
const ALL_ICON_KEYS = Object.keys(SolidIcons).filter((k) => k.endsWith('Icon'))

function iconLabel(key: string): string {
  return key
    .replace(/Icon$/, '')
    .replace(/([A-Z])/g, ' $1')
    .trim()
    .toLowerCase()
}

interface CategoryFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialValues?: {
    id: HelpCenterCategoryId
    name: string
    description: string | null
    icon: string | null
    isPublic: boolean
    parentId: HelpCenterCategoryId | null
  }
  /** Pre-selected parent when creating a new category (ignored if initialValues is set). */
  defaultParentId?: HelpCenterCategoryId | null
  onCreated?: (categoryId: string) => void
}

export function CategoryFormDialog({
  open,
  onOpenChange,
  initialValues,
  defaultParentId,
  onCreated,
}: CategoryFormDialogProps) {
  const isEdit = !!initialValues
  const createCategory = useCreateCategory()
  const updateCategory = useUpdateCategory()

  const [icon, setIcon] = useState(DEFAULT_ICON)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isPublic, setIsPublic] = useState(true)
  const [parentId, setParentId] = useState<HelpCenterCategoryId | null>(null)
  const [iconPickerOpen, setIconPickerOpen] = useState(false)
  const [iconSearch, setIconSearch] = useState('')

  useEffect(() => {
    if (open) {
      setIcon(initialValues?.icon || DEFAULT_ICON)
      setName(initialValues?.name || '')
      setDescription(initialValues?.description || '')
      setIsPublic(initialValues?.isPublic ?? true)
      setParentId(initialValues?.parentId ?? defaultParentId ?? null)
    }
  }, [open, initialValues, defaultParentId])

  const { data: allCategories = [] } = useQuery({
    ...helpCenterQueries.categories(),
    enabled: open,
  })

  const eligibleParents = useMemo(() => {
    const flat = allCategories as Array<{
      id: string
      parentId: string | null
      name: string
      icon: string | null
      articleCount: number
    }>

    const excluded = new Set<string>()
    if (initialValues?.id) {
      for (const ex of collectDescendantIdsIncludingSelf(flat, initialValues.id)) {
        excluded.add(ex)
      }
    }

    const subtreeHeight = initialValues?.id ? getSubtreeMaxDepth(flat, initialValues.id) : 0

    return flat.filter((cat) => {
      if (excluded.has(cat.id)) return false
      const parentDepth = getCategoryDepth(flat, cat.id)
      return parentDepth + 1 + subtreeHeight <= MAX_CATEGORY_DEPTH - 1
    })
  }, [allCategories, initialValues?.id])

  const filteredIcons = useMemo(() => {
    const q = iconSearch.toLowerCase().trim()
    if (!q) return ALL_ICON_KEYS
    return ALL_ICON_KEYS.filter((k) => iconLabel(k).includes(q))
  }, [iconSearch])

  const isPending = createCategory.isPending || updateCategory.isPending

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    const trimmedName = name.trim()
    const trimmedDesc = description.trim()
    if (!trimmedName) return

    if (isEdit) {
      await updateCategory.mutateAsync({
        id: initialValues.id,
        name: trimmedName,
        description: trimmedDesc || null,
        icon,
        isPublic,
        parentId,
      })
    } else {
      const result = await createCategory.mutateAsync({
        name: trimmedName,
        description: trimmedDesc || undefined,
        icon,
        isPublic,
        parentId,
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
          <div className="space-y-2">
            <Label htmlFor="category-name">Name</Label>
            <div className="flex items-center gap-2">
              <Popover
                open={iconPickerOpen}
                onOpenChange={(o) => {
                  setIconPickerOpen(o)
                  if (!o) setIconSearch('')
                }}
              >
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="h-9 w-9 rounded-md border border-border/50 flex items-center justify-center hover:bg-muted transition-colors shrink-0"
                  >
                    <CategoryIcon icon={icon} className="w-5 h-5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-2" align="start">
                  <Input
                    placeholder="Search icons…"
                    value={iconSearch}
                    onChange={(e) => setIconSearch(e.target.value)}
                    className="mb-2 h-8 text-sm"
                  />
                  <div className="grid grid-cols-8 gap-1 max-h-[288px] overflow-y-auto">
                    {filteredIcons.map((key) => {
                      const Icon = ICON_LOOKUP[key]
                      return (
                        <button
                          key={key}
                          type="button"
                          title={iconLabel(key)}
                          className={cn(
                            'h-8 w-8 rounded-md flex items-center justify-center hover:bg-muted transition-colors',
                            icon === key && 'bg-primary/15 ring-1 ring-inset ring-primary/30'
                          )}
                          onClick={() => {
                            setIcon(key)
                            setIconPickerOpen(false)
                            setIconSearch('')
                          }}
                        >
                          <Icon className="w-4 h-4" />
                        </button>
                      )
                    })}
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

          <div className="space-y-2">
            <Label htmlFor="category-description">Description</Label>
            <Input
              id="category-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional short description"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="category-parent">Parent category</Label>
            <Select
              value={parentId ?? '__none__'}
              onValueChange={(value) =>
                setParentId(value === '__none__' ? null : (value as HelpCenterCategoryId))
              }
            >
              <SelectTrigger id="category-parent">
                <SelectValue placeholder="No parent (top-level)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No parent (top-level)</SelectItem>
                {eligibleParents.map((cat) => (
                  <SelectItem key={cat.id} value={cat.id}>
                    <span className="flex items-center gap-1.5">
                      <CategoryIcon icon={cat.icon} className="w-4 h-4 shrink-0" />
                      {cat.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Maximum depth is {MAX_CATEGORY_DEPTH} levels. Parents that would exceed it are hidden.
            </p>
          </div>

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

- [ ] **Step 2: Typecheck**

```bash
cd apps/web && bun run typecheck 2>&1 | grep category-form-dialog
```

Expected: no output

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/admin/help-center/category-form-dialog.tsx
git commit -m "feat(help-center): replace emoji picker with heroicons picker"
```

---

### Task 3: Update admin render sites

**Files:**

- Modify: `apps/web/src/components/admin/help-center/help-center-category-tree.tsx`
- Modify: `apps/web/src/components/admin/help-center/help-center-finder.tsx`
- Modify: `apps/web/src/components/admin/help-center/help-center-metadata-sidebar.tsx`
- Modify: `apps/web/src/components/admin/help-center/help-center-article-editor.tsx`

- [ ] **Step 1: Update help-center-category-tree.tsx**

Add to imports (after the existing heroicons import on line 2):

```tsx
import { CategoryIcon } from '@/components/help-center/category-icon'
```

Replace line 203:

```tsx
// before
<span className="shrink-0 text-sm leading-none">{category.icon || '📁'}</span>
// after
<CategoryIcon icon={category.icon} className="w-4 h-4 shrink-0 text-muted-foreground" />
```

- [ ] **Step 2: Update help-center-finder.tsx**

Add to imports:

```tsx
import { CategoryIcon } from '@/components/help-center/category-icon'
```

Replace line 363 (breadcrumb chip — was conditional, keep conditional):

```tsx
// before
{
  cat.icon && <span className="text-sm leading-none">{cat.icon}</span>
}
// after
{
  cat.icon && <CategoryIcon icon={cat.icon} className="w-4 h-4 shrink-0" />
}
```

Replace line 431 (list row — was always-shown with fallback):

```tsx
// before
<span className="text-base">{cat.icon || '📁'}</span>
// after
<CategoryIcon icon={cat.icon} className="w-5 h-5 shrink-0" />
```

- [ ] **Step 3: Update help-center-metadata-sidebar.tsx**

Add to imports:

```tsx
import { CategoryIcon } from '@/components/help-center/category-icon'
```

Replace line 61 (was conditional, keep conditional):

```tsx
// before
{
  cat.icon && <span>{cat.icon}</span>
}
// after
{
  cat.icon && <CategoryIcon icon={cat.icon} className="w-4 h-4 shrink-0" />
}
```

- [ ] **Step 4: Update help-center-article-editor.tsx**

Add to imports:

```tsx
import { CategoryIcon } from '@/components/help-center/category-icon'
```

Replace line 205 (trigger button — was conditional, keep conditional):

```tsx
// before
{
  currentCategory?.icon && <span>{currentCategory.icon}</span>
}
// after
{
  currentCategory?.icon && <CategoryIcon icon={currentCategory.icon} className="w-4 h-4 shrink-0" />
}
```

Replace line 214 (dropdown item — was conditional, keep conditional):

```tsx
// before
{
  cat.icon && <span>{cat.icon}</span>
}
// after
{
  cat.icon && <CategoryIcon icon={cat.icon} className="w-4 h-4 shrink-0" />
}
```

- [ ] **Step 5: Typecheck**

```bash
cd apps/web && bun run typecheck 2>&1 | grep -E "help-center-category-tree|help-center-finder|metadata-sidebar|article-editor"
```

Expected: no output

- [ ] **Step 6: Commit**

```bash
git add \
  apps/web/src/components/admin/help-center/help-center-category-tree.tsx \
  apps/web/src/components/admin/help-center/help-center-finder.tsx \
  apps/web/src/components/admin/help-center/help-center-metadata-sidebar.tsx \
  apps/web/src/components/admin/help-center/help-center-article-editor.tsx
git commit -m "feat(help-center): use CategoryIcon in admin render sites"
```

---

### Task 4: Update public and widget render sites

**Files:**

- Modify: `apps/web/src/components/help-center/help-center-category-grid.tsx`
- Modify: `apps/web/src/components/widget/widget-help.tsx`
- Modify: `apps/web/src/components/widget/widget-help-category.tsx`
- Modify: `apps/web/src/routes/_portal/hc/categories/$categorySlug/index.tsx`

- [ ] **Step 1: Update help-center-category-grid.tsx**

Add to imports (same directory, use relative path):

```tsx
import { CategoryIcon } from './category-icon'
```

Replace lines 70–71 (remove `text-base` text sizing, add icon component):

```tsx
// before
<div className="shrink-0 w-9 h-9 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center text-base">
  {cat.icon ?? '📁'}
</div>
// after
<div className="shrink-0 w-9 h-9 rounded-lg bg-primary/10 border border-primary/15 flex items-center justify-center">
  <CategoryIcon icon={cat.icon} className="w-5 h-5 text-primary" />
</div>
```

- [ ] **Step 2: Update widget-help.tsx**

Add to imports:

```tsx
import { CategoryIcon } from '@/components/help-center/category-icon'
```

Replace line 137 (widget card icon — always render for consistent layout):

```tsx
// before
{
  cat.icon && <div className="text-lg mb-1">{cat.icon}</div>
}
// after
;<CategoryIcon icon={cat.icon} className="w-6 h-6 mb-1" />
```

- [ ] **Step 3: Update widget-help-category.tsx**

Add to imports:

```tsx
import { CategoryIcon } from '@/components/help-center/category-icon'
```

Replace line 27 (category header in article-list view — keep conditional, `categoryIcon` prop is `string | null`):

```tsx
// before
{
  categoryIcon && <span className="text-lg">{categoryIcon}</span>
}
// after
{
  categoryIcon && <CategoryIcon icon={categoryIcon} className="w-5 h-5 shrink-0" />
}
```

- [ ] **Step 4: Update portal category route**

File: `apps/web/src/routes/_portal/hc/categories/$categorySlug/index.tsx`

Add to imports (near other component imports at the top of the file):

```tsx
import { CategoryIcon } from '@/components/help-center/category-icon'
```

Replace lines 197–199 (large category header icon — white icon on primary bg):

```tsx
// before
<div className="w-14 h-14 rounded-xl bg-primary flex items-center justify-center text-2xl mb-5 select-none">
  {category.icon ?? '📁'}
</div>
// after
<div className="w-14 h-14 rounded-xl bg-primary flex items-center justify-center mb-5">
  <CategoryIcon icon={category.icon} className="w-8 h-8 text-primary-foreground" />
</div>
```

Replace lines 237–239 (subcategory section header — remove wrapping span):

```tsx
// before
<span className="text-base leading-none shrink-0">
  {sub.icon ?? '📁'}
</span>
// after
<CategoryIcon icon={sub.icon} className="w-5 h-5 shrink-0" />
```

- [ ] **Step 5: Typecheck**

```bash
cd apps/web && bun run typecheck 2>&1 | grep -E "help-center-category-grid|widget-help|categorySlug"
```

Expected: no output

- [ ] **Step 6: Run existing tests**

```bash
cd apps/web && bun run test 2>&1 | tail -20
```

Expected: all tests pass (the `icon` column type is unchanged — existing service tests are unaffected)

- [ ] **Step 7: Commit**

```bash
git add \
  apps/web/src/components/help-center/help-center-category-grid.tsx \
  apps/web/src/components/widget/widget-help.tsx \
  apps/web/src/components/widget/widget-help-category.tsx \
  "apps/web/src/routes/_portal/hc/categories/\$categorySlug/index.tsx"
git commit -m "feat(help-center): use CategoryIcon in public and widget render sites"
```
