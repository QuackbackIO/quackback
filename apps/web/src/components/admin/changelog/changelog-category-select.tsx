import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { PlusIcon } from '@heroicons/react/24/outline'
import { XMarkIcon } from '@heroicons/react/24/solid'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { changelogCategoryQueries } from '@/lib/client/queries/changelog'
import { cn } from '@/lib/shared/utils'
import type { ChangelogCategoryId } from '@quackback/ids'

interface ChangelogCategorySelectProps {
  value: ChangelogCategoryId[]
  onChange: (categoryIds: ChangelogCategoryId[]) => void
}

/**
 * Multi-select chips control for attaching labels (categories) to a
 * changelog entry. Fetches the workspace's categories and renders selected
 * ones as removable colored chips, with an "Add" popover for the rest.
 */
export function ChangelogCategorySelect({ value, onChange }: ChangelogCategorySelectProps) {
  const [open, setOpen] = useState(false)
  const { data: categories = [] } = useQuery(changelogCategoryQueries.list())

  const selected = categories.filter((c) => value.includes(c.id))
  const unselected = categories.filter((c) => !value.includes(c.id))

  function toggle(id: ChangelogCategoryId) {
    if (value.includes(id)) {
      onChange(value.filter((v) => v !== id))
    } else {
      onChange([...value, id])
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {selected.map((category) => (
        <span
          key={category.id}
          className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium"
          style={{ backgroundColor: category.color + '20', color: category.color }}
        >
          {category.name}
          <button
            type="button"
            onClick={() => toggle(category.id)}
            aria-label={`Remove ${category.name}`}
            className="opacity-60 hover:opacity-100"
          >
            <XMarkIcon className="h-3 w-3" />
          </button>
        </span>
      ))}

      {categories.length === 0 ? (
        <p className="text-xs text-muted-foreground/60 italic">
          No labels yet. Create some in Settings &gt; Changelog.
        </p>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className={cn(
                'inline-flex items-center gap-0.5 px-1.5 py-0.5',
                'rounded-md text-[11px] font-medium',
                'text-muted-foreground/70 hover:text-muted-foreground',
                'border border-dashed border-border/60 hover:border-border',
                'hover:bg-muted/40',
                'transition-all duration-150'
              )}
            >
              <PlusIcon className="h-2.5 w-2.5" />
              Add
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-1" align="start">
            {unselected.length === 0 ? (
              <p className="py-4 text-center text-xs text-muted-foreground">
                All labels applied
              </p>
            ) : (
              unselected.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => toggle(category.id)}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
                >
                  <span
                    className="h-2.5 w-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: category.color }}
                  />
                  <span className="flex-1 text-left truncate">{category.name}</span>
                </button>
              ))
            )}
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
