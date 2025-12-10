'use client'

import { useState, useCallback } from 'react'
import { Filter } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { PostStatusEntity, Tag } from '@quackback/db/types'

interface FilterDropdownProps {
  statuses: PostStatusEntity[]
  tags: Tag[]
  selectedStatuses: string[]
  selectedTagIds: string[]
  onStatusChange: (statuses: string[]) => void
  onTagChange: (tagIds: string[]) => void
  onClearFilters: () => void
  activeCount: number
}

export function FilterDropdown({
  statuses,
  tags,
  selectedStatuses,
  selectedTagIds,
  onStatusChange,
  onTagChange,
  onClearFilters,
  activeCount,
}: FilterDropdownProps) {
  const [open, setOpen] = useState(false)

  const handleStatusToggle = useCallback(
    (statusSlug: string) => {
      const newStatuses = selectedStatuses.includes(statusSlug)
        ? selectedStatuses.filter((s) => s !== statusSlug)
        : [...selectedStatuses, statusSlug]
      onStatusChange(newStatuses)
    },
    [selectedStatuses, onStatusChange]
  )

  const handleTagToggle = useCallback(
    (tagId: string) => {
      const newTagIds = selectedTagIds.includes(tagId)
        ? selectedTagIds.filter((t) => t !== tagId)
        : [...selectedTagIds, tagId]
      onTagChange(newTagIds)
    },
    [selectedTagIds, onTagChange]
  )

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5 relative">
          <Filter className="h-4 w-4" />
          Filter
          {activeCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-primary text-[10px] font-medium text-primary-foreground flex items-center justify-center">
              {activeCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="end">
        <div className="space-y-4">
          {/* Header with clear button */}
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-sm">Filters</h4>
            {activeCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="h-auto p-0 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => {
                  onClearFilters()
                }}
              >
                Clear all
              </Button>
            )}
          </div>

          {/* Status Filter */}
          {statuses.length > 0 && (
            <div className="space-y-2">
              <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Status
              </h5>
              <div className="space-y-1.5">
                {statuses.map((status) => (
                  <label
                    key={status.id}
                    className="flex items-center gap-2.5 cursor-pointer text-sm py-0.5 group"
                  >
                    <Checkbox
                      checked={selectedStatuses.includes(status.slug)}
                      onCheckedChange={() => handleStatusToggle(status.slug)}
                    />
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: status.color }}
                      aria-hidden="true"
                    />
                    <span className="text-foreground/80 group-hover:text-foreground transition-colors">
                      {status.name}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Tags Filter */}
          {tags.length > 0 && (
            <div className="space-y-2">
              <h5 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Tags
              </h5>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((tag) => {
                  const isSelected = selectedTagIds.includes(tag.id)
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => handleTagToggle(tag.id)}
                      className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                        isSelected
                          ? 'bg-foreground text-background'
                          : 'bg-muted text-muted-foreground hover:bg-muted/80'
                      }`}
                    >
                      {tag.name}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Empty state */}
          {statuses.length === 0 && tags.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-2">No filters available</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
