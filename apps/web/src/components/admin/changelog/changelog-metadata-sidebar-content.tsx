'use client'

import { useState } from 'react'
import {
  DocumentTextIcon,
  PlusIcon,
  MagnifyingGlassIcon,
  ChevronUpIcon,
  UserIcon,
} from '@heroicons/react/24/outline'
import { CheckIcon } from '@heroicons/react/24/solid'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Checkbox } from '@/components/ui/checkbox'
import { DateTimePicker } from '@/components/ui/datetime-picker'
import { useQuery } from '@tanstack/react-query'
import { searchShippedPostsFn } from '@/lib/server/functions/changelog'
import { TimeAgo } from '@/components/ui/time-ago'
import {
  SidebarRow,
  StatusSelect,
  ListItem,
  VoteCount,
  ListItemRemoveButton,
  type StatusOption,
} from '@/components/shared/sidebar-primitives'
import { cn } from '@/lib/shared/utils'
import type { PostId } from '@quackback/ids'
import type { PublishState } from '@/lib/shared/schemas/changelog'

interface ChangelogMetadataSidebarContentProps {
  publishState: PublishState
  onPublishStateChange: (state: PublishState) => void
  linkedPostIds: PostId[]
  onLinkedPostsChange: (postIds: PostId[]) => void
  authorName?: string | null
}

const PUBLISH_STATUS_OPTIONS: readonly StatusOption[] = [
  { value: 'draft', label: 'Draft', color: '#94a3b8' }, // slate-400
  { value: 'scheduled', label: 'Scheduled', color: '#f59e0b' }, // amber-500
  { value: 'published', label: 'Published', color: '#22c55e' }, // green-500
]

export function ChangelogMetadataSidebarContent({
  publishState,
  onPublishStateChange,
  linkedPostIds,
  onLinkedPostsChange,
  authorName,
}: ChangelogMetadataSidebarContentProps) {
  const [postsOpen, setPostsOpen] = useState(false)
  const [search, setSearch] = useState('')

  // Default scheduled time to tomorrow at 9am
  const [scheduledDateTime, setScheduledDateTime] = useState<Date>(() => {
    if (publishState.type === 'scheduled') {
      return publishState.publishAt
    }
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(9, 0, 0, 0)
    return tomorrow
  })

  // Search shipped posts
  const { data: posts = [], isLoading: postsLoading } = useQuery({
    queryKey: ['shipped-posts', search],
    queryFn: () => searchShippedPostsFn({ data: { query: search || undefined, limit: 30 } }),
    staleTime: 30 * 1000,
  })

  // Get selected post details
  const selectedPosts = posts.filter((p) => linkedPostIds.includes(p.id))

  const handleStatusChange = (value: string) => {
    const type = value as 'draft' | 'scheduled' | 'published'
    if (type === 'draft') {
      onPublishStateChange({ type: 'draft' })
    } else if (type === 'scheduled') {
      onPublishStateChange({ type: 'scheduled', publishAt: new Date(scheduledDateTime) })
    } else {
      onPublishStateChange({ type: 'published' })
    }
  }

  const handleDateTimeChange = (date: Date | undefined) => {
    if (date) {
      setScheduledDateTime(date)
      if (publishState.type === 'scheduled') {
        onPublishStateChange({ type: 'scheduled', publishAt: date })
      }
    }
  }

  const handleTogglePost = (postId: PostId) => {
    if (linkedPostIds.includes(postId)) {
      onLinkedPostsChange(linkedPostIds.filter((id) => id !== postId))
    } else {
      onLinkedPostsChange([...linkedPostIds, postId])
    }
  }

  const handleRemovePost = (postId: PostId) => {
    onLinkedPostsChange(linkedPostIds.filter((id) => id !== postId))
  }

  return (
    <div className="space-y-5">
      {/* Status - uses shared StatusSelect component */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">Status</span>
        <StatusSelect
          value={publishState.type}
          options={PUBLISH_STATUS_OPTIONS}
          onChange={handleStatusChange}
        />
      </div>

      {/* Author */}
      {authorName && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <UserIcon className="h-4 w-4" />
            <span>Author</span>
          </div>
          <span className="text-sm font-medium text-foreground">{authorName}</span>
        </div>
      )}

      {/* Schedule Date - only show when scheduled */}
      {publishState.type === 'scheduled' && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Schedule</span>
          <DateTimePicker
            value={scheduledDateTime}
            onChange={handleDateTimeChange}
            minDate={new Date()}
            className="h-7 text-xs"
          />
        </div>
      )}

      {/* Linked Posts - single unified section */}
      <div className="space-y-2">
        <SidebarRow icon={<DocumentTextIcon className="h-4 w-4" />} label="Linked Posts">
          <Popover open={postsOpen} onOpenChange={setPostsOpen}>
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
            <PopoverContent className="w-72 p-0" align="end" sideOffset={4}>
              <div className="flex items-center border-b px-3">
                <MagnifyingGlassIcon className="mr-2 h-4 w-4 shrink-0 opacity-50" />
                <input
                  placeholder="Search shipped posts..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="flex h-9 w-full border-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-0"
                />
              </div>
              <ScrollArea className="h-[250px]">
                <div className="p-1">
                  {postsLoading ? (
                    <div className="py-6 text-center text-sm text-muted-foreground">Loading...</div>
                  ) : posts.length === 0 ? (
                    <div className="py-6 text-center text-sm text-muted-foreground">
                      {search ? 'No shipped posts found.' : 'No shipped posts yet.'}
                    </div>
                  ) : (
                    posts.map((post) => {
                      const isSelected = linkedPostIds.includes(post.id)
                      return (
                        <div
                          key={post.id}
                          onClick={() => handleTogglePost(post.id)}
                          className={cn(
                            'relative flex items-start gap-2.5 cursor-pointer select-none rounded-sm px-2 py-1.5 text-sm outline-none hover:bg-accent hover:text-accent-foreground',
                            isSelected && 'bg-accent/50'
                          )}
                        >
                          <Checkbox checked={isSelected} className="mt-0.5" />
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-xs truncate">{post.title}</div>
                            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                              <span className="flex items-center gap-0.5">
                                <ChevronUpIcon className="h-2.5 w-2.5" />
                                {post.voteCount}
                              </span>
                              <span>·</span>
                              <span>{post.boardSlug}</span>
                            </div>
                          </div>
                          {isSelected && (
                            <CheckIcon className="h-3.5 w-3.5 text-primary shrink-0" />
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              </ScrollArea>
            </PopoverContent>
          </Popover>
        </SidebarRow>

        {/* Selected posts as cards */}
        {selectedPosts.length > 0 ? (
          <div className="space-y-1.5">
            {selectedPosts.map((post) => (
              <ListItem
                key={post.id}
                left={<VoteCount count={post.voteCount} />}
                title={post.title}
                meta={[
                  <span key="author">{post.authorName || 'Anonymous'}</span>,
                  <TimeAgo key="date" date={post.createdAt} className="text-muted-foreground/70" />,
                  <span key="board">{post.boardSlug}</span>,
                ]}
                action={
                  <ListItemRemoveButton
                    onClick={() => handleRemovePost(post.id)}
                    label={`Remove ${post.title}`}
                  />
                }
              />
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground/60 italic pl-6">No posts linked yet</p>
        )}
      </div>
    </div>
  )
}
