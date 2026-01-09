import { useState } from 'react'
import {
  XMarkIcon,
  PlusIcon,
  ArrowPathIcon,
  CheckIcon,
  ChevronUpDownIcon,
  ChatBubbleLeftIcon,
  HandThumbUpIcon,
} from '@heroicons/react/24/solid'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { ScrollArea } from '@/components/ui/scroll-area'
import { TimeAgo } from '@/components/ui/time-ago'
import { cn } from '@/lib/utils'
import { getInitials } from '@/lib/utils/string'
import type { PostDetails } from '@/components/admin/feedback/inbox-types'
import type { Tag, PostStatusEntity, Board } from '@/lib/db-types'
import type { StatusId, TagId } from '@quackback/ids'

interface DetailPropertiesProps {
  post: PostDetails
  boards: Board[]
  tags: Tag[]
  statuses: PostStatusEntity[]
  avatarUrls?: Record<string, string | null>
  onStatusChange: (statusId: StatusId) => Promise<void>
  onTagsChange: (tagIds: TagId[]) => Promise<void>
  isUpdating: boolean
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70 mb-2.5">
      {children}
    </h3>
  )
}

function PropertyItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <span className="text-xs font-medium text-muted-foreground/80">{label}</span>
      <div>{children}</div>
    </div>
  )
}

export function DetailProperties({
  post,
  boards,
  tags,
  statuses,
  avatarUrls,
  onStatusChange,
  onTagsChange,
  isUpdating,
}: DetailPropertiesProps) {
  const [statusOpen, setStatusOpen] = useState(false)
  const [tagOpen, setTagOpen] = useState(false)

  const currentStatus = statuses.find((s) => s.id === post.statusId)
  const currentBoard = boards.find((b) => b.id === post.board.id)

  const handleStatusChange = async (statusId: StatusId) => {
    setStatusOpen(false)
    await onStatusChange(statusId)
  }

  const handleTagToggle = async (tagId: TagId) => {
    const currentTagIds = post.tags.map((t) => t.id)
    const newTagIds = currentTagIds.includes(tagId)
      ? currentTagIds.filter((id) => id !== tagId)
      : [...currentTagIds, tagId]
    await onTagsChange(newTagIds)
  }

  const handleAddTag = async (tagId: TagId) => {
    const currentTagIds = post.tags.map((t) => t.id)
    if (!currentTagIds.includes(tagId)) {
      await onTagsChange([...currentTagIds, tagId])
    }
    setTagOpen(false)
  }

  return (
    <aside className="hidden lg:flex w-64 xl:w-72 shrink-0 flex-col border-r border-border/50 bg-gradient-to-b from-card/50 to-card/30 overflow-hidden">
      <ScrollArea className="h-full">
        <div className="p-5 space-y-6">
          {/* Properties Section */}
          <div>
            <SectionHeader>Properties</SectionHeader>
            <div className="space-y-4">
              {/* Status */}
              <PropertyItem label="Status">
                <Popover open={statusOpen} onOpenChange={setStatusOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      disabled={isUpdating}
                      className={cn(
                        'group flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs w-full',
                        'bg-muted/40 hover:bg-muted/60 border border-transparent hover:border-border/50',
                        'transition-all duration-150 ease-out',
                        'disabled:opacity-50 disabled:cursor-not-allowed',
                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
                      )}
                    >
                      <span
                        className="h-2 w-2 rounded-full shrink-0 ring-2 ring-white/10 shadow-sm"
                        style={{ backgroundColor: currentStatus?.color || '#94a3b8' }}
                      />
                      <span className="font-medium flex-1 text-left text-foreground/90">
                        {currentStatus?.name || 'No Status'}
                      </span>
                      {isUpdating ? (
                        <ArrowPathIcon className="h-3 w-3 animate-spin text-muted-foreground" />
                      ) : (
                        <ChevronUpDownIcon className="h-3 w-3 text-muted-foreground/60 group-hover:text-muted-foreground transition-colors" />
                      )}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-44 p-1" sideOffset={4}>
                    <div className="space-y-0.5">
                      {statuses.map((status) => (
                        <button
                          key={status.id}
                          type="button"
                          onClick={() => handleStatusChange(status.id)}
                          className={cn(
                            'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs',
                            'transition-all duration-100 ease-out',
                            status.id === currentStatus?.id
                              ? 'bg-primary/10 text-foreground'
                              : 'hover:bg-muted/60 text-foreground/80 hover:text-foreground'
                          )}
                        >
                          <span
                            className="h-2 w-2 rounded-full shrink-0 shadow-sm"
                            style={{ backgroundColor: status.color }}
                          />
                          <span className="flex-1 text-left font-medium">{status.name}</span>
                          {status.id === currentStatus?.id && (
                            <CheckIcon className="h-3 w-3 text-primary" />
                          )}
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
              </PropertyItem>

              {/* Board */}
              <PropertyItem label="Board">
                <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-muted/30 text-xs">
                  <span className="font-medium text-foreground/90">
                    {currentBoard?.name || 'Unknown'}
                  </span>
                </div>
              </PropertyItem>

              {/* Tags */}
              <PropertyItem label="Tags">
                <div className="flex flex-wrap items-center gap-1.5">
                  {post.tags.map((tag) => (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => handleTagToggle(tag.id)}
                      disabled={isUpdating}
                      className={cn(
                        'group inline-flex items-center gap-1 pl-2 pr-1.5 py-0.5',
                        'rounded-full text-[11px] font-medium',
                        'bg-primary/8 text-primary/90 border border-primary/15',
                        'hover:bg-primary/12 hover:border-primary/25',
                        'transition-all duration-150 ease-out',
                        'disabled:opacity-50 disabled:cursor-not-allowed'
                      )}
                    >
                      {tag.name}
                      <XMarkIcon className="h-2.5 w-2.5 opacity-40 group-hover:opacity-80 transition-opacity" />
                    </button>
                  ))}
                  {tags.filter((t) => !post.tags.some((pt) => pt.id === t.id)).length > 0 && (
                    <Popover open={tagOpen} onOpenChange={setTagOpen}>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          disabled={isUpdating}
                          className={cn(
                            'inline-flex items-center gap-1 px-2 py-0.5',
                            'rounded-full text-[11px] font-medium',
                            'text-muted-foreground/70 hover:text-muted-foreground',
                            'border border-dashed border-border/60 hover:border-border',
                            'hover:bg-muted/40',
                            'transition-all duration-150 ease-out',
                            'disabled:opacity-50'
                          )}
                        >
                          <PlusIcon className="h-2.5 w-2.5" />
                          Add
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-40 p-1" align="start" sideOffset={4}>
                        <div className="max-h-48 overflow-y-auto space-y-0.5">
                          {tags
                            .filter((tag) => !post.tags.some((t) => t.id === tag.id))
                            .map((tag) => (
                              <button
                                key={tag.id}
                                type="button"
                                onClick={() => handleAddTag(tag.id)}
                                className={cn(
                                  'w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-md',
                                  'text-foreground/80 hover:text-foreground hover:bg-muted/60',
                                  'transition-all duration-100 ease-out text-left font-medium'
                                )}
                              >
                                {tag.name}
                              </button>
                            ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}
                  {post.tags.length === 0 && !tagOpen && (
                    <span className="text-xs text-muted-foreground/60 italic">No tags</span>
                  )}
                </div>
              </PropertyItem>
            </div>
          </div>

          {/* Author Section */}
          <div className="border-t border-border/30 pt-5">
            <SectionHeader>Author</SectionHeader>
            <div className="flex items-center gap-2.5 p-2.5 rounded-lg bg-muted/25 hover:bg-muted/40 transition-colors duration-150">
              <Avatar className="h-8 w-8 ring-2 ring-background shadow-sm">
                {post.memberId && avatarUrls?.[post.memberId] && (
                  <AvatarImage src={avatarUrls[post.memberId]!} alt={post.authorName || 'Author'} />
                )}
                <AvatarFallback className="text-xs bg-primary/10 text-primary font-medium">
                  {getInitials(post.authorName)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium truncate text-foreground/90">
                  {post.authorName || 'Anonymous'}
                </p>
                <p className="text-[10px] text-muted-foreground/70">
                  Submitted <TimeAgo date={post.createdAt} />
                </p>
              </div>
            </div>
          </div>

          {/* Stats Section */}
          <div className="border-t border-border/30 pt-5">
            <SectionHeader>Engagement</SectionHeader>
            <div className="grid grid-cols-2 gap-2">
              <div className="group relative p-2.5 rounded-lg bg-gradient-to-br from-muted/40 to-muted/20 border border-border/30 hover:border-border/50 transition-all duration-150">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <HandThumbUpIcon className="h-3 w-3 text-muted-foreground/50" />
                  <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground/60">
                    Votes
                  </span>
                </div>
                <p className="text-xl font-bold tabular-nums text-foreground/90">
                  {post.voteCount}
                </p>
              </div>
              <div className="group relative p-2.5 rounded-lg bg-gradient-to-br from-muted/40 to-muted/20 border border-border/30 hover:border-border/50 transition-all duration-150">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <ChatBubbleLeftIcon className="h-3 w-3 text-muted-foreground/50" />
                  <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground/60">
                    Comments
                  </span>
                </div>
                <p className="text-xl font-bold tabular-nums text-foreground/90">
                  {post.comments?.length || 0}
                </p>
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>
    </aside>
  )
}
