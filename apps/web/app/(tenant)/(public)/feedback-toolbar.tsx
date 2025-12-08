'use client'

import { useState } from 'react'
import { TrendingUp, Clock, Flame, Search, Filter, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SubmitPostDialog } from '@/components/public/submit-post-dialog'
import { cn } from '@/lib/utils'

interface BoardOption {
  id: string
  name: string
  slug: string
}

interface FeedbackToolbarProps {
  currentSort: 'top' | 'new' | 'trending'
  currentSearch?: string
  onSortChange: (sort: 'top' | 'new' | 'trending') => void
  onSearchChange: (search: string) => void
  boards: BoardOption[]
  defaultBoardId?: string
}

const sortOptions = [
  { value: 'top', label: 'Top', icon: TrendingUp },
  { value: 'new', label: 'New', icon: Clock },
  { value: 'trending', label: 'Trending', icon: Flame },
] as const

export function FeedbackToolbar({
  currentSort,
  currentSearch,
  onSortChange,
  onSearchChange,
  boards,
  defaultBoardId,
}: FeedbackToolbarProps) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchValue, setSearchValue] = useState(currentSearch || '')

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    onSearchChange(searchValue)
    setSearchOpen(false)
  }

  return (
    <div className="flex items-center justify-between gap-4">
      {/* Sort Tabs */}
      <div className="flex items-center gap-1">
        {sortOptions.map((option) => {
          const Icon = option.icon
          const isActive = currentSort === option.value
          return (
            <button
              key={option.value}
              onClick={() => onSortChange(option.value)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm transition-colors',
                isActive
                  ? 'bg-muted text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              )}
            >
              <Icon className={cn('h-3.5 w-3.5', isActive && 'text-primary')} />
              {option.label}
            </button>
          )
        })}
      </div>

      {/* Right Actions */}
      <div className="flex items-center gap-2">
        {/* Search */}
        <Popover open={searchOpen} onOpenChange={setSearchOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="gap-1.5">
              <Search className="h-4 w-4" />
              Search
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80" align="end">
            <form onSubmit={handleSearchSubmit} className="flex gap-2">
              <Input
                placeholder="Search posts..."
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                className="flex-1"
                autoFocus
              />
              <Button type="submit" size="sm">
                Search
              </Button>
            </form>
            {currentSearch && (
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 w-full"
                onClick={() => {
                  setSearchValue('')
                  onSearchChange('')
                  setSearchOpen(false)
                }}
              >
                Clear search
              </Button>
            )}
          </PopoverContent>
        </Popover>

        {/* Filter (placeholder for now) */}
        <Button variant="outline" size="icon" className="h-9 w-9">
          <Filter className="h-4 w-4" />
        </Button>

        {/* Create Post */}
        {boards.length > 0 && (
          <SubmitPostDialog
            key={defaultBoardId}
            boards={boards}
            defaultBoardId={defaultBoardId}
            trigger={
              <Button size="sm" className="gap-1.5">
                <Plus className="h-4 w-4" />
                Create post
              </Button>
            }
          />
        )}
      </div>
    </div>
  )
}
