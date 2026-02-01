'use client'

import { useState, useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Checkbox } from '@/components/ui/checkbox'
import { ChevronUpDownIcon, MagnifyingGlassIcon, XMarkIcon } from '@heroicons/react/24/outline'
import { CheckIcon } from '@heroicons/react/24/solid'
import { searchShippedPostsFn } from '@/lib/server/functions/changelog'
import type { PostId, BoardId } from '@quackback/ids'
import { cn } from '@/lib/shared/utils'

interface LinkedPostsSelectorProps {
  value: PostId[]
  onChange: (postIds: PostId[]) => void
  boardId?: BoardId
  className?: string
}

export function LinkedPostsSelector({
  value,
  onChange,
  boardId,
  className,
}: LinkedPostsSelectorProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  // Debounced search query
  const { data: posts = [], isLoading } = useQuery({
    queryKey: ['shipped-posts', search, boardId],
    queryFn: () =>
      searchShippedPostsFn({
        data: {
          query: search || undefined,
          boardId,
          limit: 30,
        },
      }),
    staleTime: 30 * 1000,
  })

  const selectedPosts = useMemo(() => {
    const selectedSet = new Set(value)
    return posts.filter((p) => selectedSet.has(p.id))
  }, [posts, value])

  const handleTogglePost = useCallback(
    (postId: PostId) => {
      if (value.includes(postId)) {
        onChange(value.filter((id) => id !== postId))
      } else {
        onChange([...value, postId])
      }
    },
    [value, onChange]
  )

  const handleRemovePost = useCallback(
    (postId: PostId) => {
      onChange(value.filter((id) => id !== postId))
    },
    [value, onChange]
  )

  return (
    <div className={cn('space-y-2', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between h-auto min-h-10 py-2"
          >
            <span className="text-muted-foreground text-sm">
              {value.length === 0
                ? 'Link shipped posts...'
                : `${value.length} post${value.length === 1 ? '' : 's'} linked`}
            </span>
            <ChevronUpDownIcon className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[400px] p-0" align="start">
          <div className="flex items-center border-b px-3">
            <MagnifyingGlassIcon className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <Input
              placeholder="Search shipped posts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex h-10 w-full border-0 bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-0"
            />
          </div>
          <ScrollArea className="h-[300px]">
            <div className="p-1">
              {isLoading ? (
                <div className="py-6 text-center text-sm text-muted-foreground">Loading...</div>
              ) : posts.length === 0 ? (
                <div className="py-6 text-center text-sm text-muted-foreground">
                  {search ? 'No shipped posts found.' : 'No shipped posts yet.'}
                </div>
              ) : (
                posts.map((post) => {
                  const isSelected = value.includes(post.id)
                  return (
                    <div
                      key={post.id}
                      onClick={() => handleTogglePost(post.id)}
                      className={cn(
                        'relative flex items-start gap-3 cursor-pointer select-none rounded-sm px-2 py-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground',
                        isSelected && 'bg-accent/50'
                      )}
                    >
                      <Checkbox
                        checked={isSelected}
                        className="mt-0.5"
                        onCheckedChange={() => handleTogglePost(post.id)}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-medium truncate">{post.title}</div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{post.voteCount} votes</span>
                          <span className="text-muted-foreground/50">in {post.boardSlug}</span>
                        </div>
                      </div>
                      {isSelected && <CheckIcon className="h-4 w-4 text-primary shrink-0 mt-0.5" />}
                    </div>
                  )
                })
              )}
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>

      {/* Selected posts badges */}
      {selectedPosts.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedPosts.map((post) => (
            <Badge
              key={post.id}
              variant="secondary"
              className="text-xs font-normal gap-1 pr-1 max-w-[200px]"
            >
              <span className="truncate">{post.title}</span>
              <button
                type="button"
                onClick={() => handleRemovePost(post.id)}
                className="ml-1 rounded-full hover:bg-muted p-0.5"
              >
                <XMarkIcon className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}
