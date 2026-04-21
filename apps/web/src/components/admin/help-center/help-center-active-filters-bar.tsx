import { useState } from 'react'
import { PlusIcon } from '@heroicons/react/16/solid'
import { FolderIcon, TagIcon, TrashIcon } from '@heroicons/react/24/outline'
import { cn } from '@/lib/shared/utils'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { FilterChip } from '@/components/shared/filter-chip'
import type { HelpCenterStatusFilter } from './use-help-center-filters'

interface Category {
  id: string
  name: string
}

interface HelpCenterActiveFiltersBarProps {
  status: HelpCenterStatusFilter
  category?: string
  /** Pre-built display label (e.g. "Parent › Child") — overrides the ID lookup. */
  categoryLabel?: string
  categories: ReadonlyArray<Category>
  showDeleted?: boolean
  onClearStatus: () => void
  onClearCategory: () => void
  onClearShowDeleted: () => void
  onClearAll: () => void
  onSetStatus: (status: 'draft' | 'published') => void
  onSetCategory: (categoryId: string) => void
}

const STATUS_OPTIONS: { id: 'draft' | 'published'; label: string }[] = [
  { id: 'draft', label: 'Draft' },
  { id: 'published', label: 'Published' },
]

const MENU_ITEM_CLASS = cn(
  'w-full flex items-center gap-2 px-2.5 py-1.5 text-xs',
  'text-foreground/80 hover:bg-muted/50 transition-colors'
)

export function HelpCenterActiveFiltersBar({
  status,
  category,
  categoryLabel,
  categories,
  showDeleted,
  onClearStatus,
  onClearCategory,
  onClearShowDeleted,
  onClearAll,
  onSetStatus,
  onSetCategory,
}: HelpCenterActiveFiltersBarProps) {
  const categoryName = category
    ? (categoryLabel ?? categories.find((c) => c.id === category)?.name ?? 'Category')
    : null

  const hasStatusFilter = status !== 'all'
  const hasCategoryFilter = !!categoryName

  const canAddStatus = !hasStatusFilter
  const canAddCategory = !hasCategoryFilter
  const canAddAny = canAddStatus || canAddCategory

  const activeCount = (hasStatusFilter ? 1 : 0) + (hasCategoryFilter ? 1 : 0) + (showDeleted ? 1 : 0)

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {hasStatusFilter && (
        <FilterChip
          icon={TagIcon}
          label="Status"
          value={status === 'draft' ? 'Draft' : 'Published'}
          valueId={status}
          onRemove={onClearStatus}
          onChange={(id) => onSetStatus(id as 'draft' | 'published')}
          options={STATUS_OPTIONS}
        />
      )}

      {hasCategoryFilter && (
        <FilterChip
          icon={FolderIcon}
          label="Category"
          value={categoryName!}
          valueId={category!}
          onRemove={onClearCategory}
          onChange={onSetCategory}
          options={categories.map((c) => ({ id: c.id, label: c.name }))}
        />
      )}

      {showDeleted && (
        <FilterChip
          icon={TrashIcon}
          label="Showing"
          value="deleted"
          valueId="deleted"
          onRemove={onClearShowDeleted}
        />
      )}

      {canAddAny && (
        <AddFilterButton
          canAddStatus={canAddStatus}
          canAddCategory={canAddCategory}
          categories={categories}
          onSetStatus={onSetStatus}
          onSetCategory={onSetCategory}
        />
      )}

      {activeCount > 1 && (
        <button
          type="button"
          onClick={onClearAll}
          className="ml-1 text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
        >
          Clear all
        </button>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Add filter popover
// ---------------------------------------------------------------------------

interface AddFilterButtonProps {
  canAddStatus: boolean
  canAddCategory: boolean
  categories: ReadonlyArray<Category>
  onSetStatus: (status: 'draft' | 'published') => void
  onSetCategory: (categoryId: string) => void
}

function AddFilterButton({
  canAddStatus,
  canAddCategory,
  categories,
  onSetStatus,
  onSetCategory,
}: AddFilterButtonProps) {
  const [open, setOpen] = useState(false)
  const [activeMenu, setActiveMenu] = useState<null | 'status' | 'category'>(null)

  const handleOpenChange = (o: boolean) => {
    setOpen(o)
    if (!o) setActiveMenu(null)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1 px-2 py-0.5',
            'rounded-full text-xs',
            'border border-dashed border-border/50',
            'text-muted-foreground hover:text-foreground',
            'hover:border-border hover:bg-muted/30',
            'transition-colors'
          )}
        >
          <PlusIcon className="h-3 w-3" />
          Add filter
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-44 p-0">
        <div className="py-1">
          {activeMenu === null && (
            <>
              {canAddStatus && (
                <button
                  type="button"
                  className={MENU_ITEM_CLASS}
                  onClick={() => setActiveMenu('status')}
                >
                  <TagIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  Status
                </button>
              )}
              {canAddCategory && (
                <button
                  type="button"
                  className={MENU_ITEM_CLASS}
                  onClick={() => setActiveMenu('category')}
                >
                  <FolderIcon className="h-3.5 w-3.5 text-muted-foreground" />
                  Category
                </button>
              )}
            </>
          )}

          {activeMenu === 'status' &&
            STATUS_OPTIONS.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={MENU_ITEM_CLASS}
                onClick={() => {
                  onSetStatus(opt.id)
                  setOpen(false)
                }}
              >
                {opt.label}
              </button>
            ))}

          {activeMenu === 'category' && (
            <div className="max-h-[220px] overflow-y-auto">
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  className={MENU_ITEM_CLASS}
                  onClick={() => {
                    onSetCategory(cat.id)
                    setOpen(false)
                  }}
                >
                  {cat.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
