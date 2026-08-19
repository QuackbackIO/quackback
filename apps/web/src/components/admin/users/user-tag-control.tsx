'use client'

/**
 * Tag control on a portal person's profile: the person's tags as removable
 * badges plus a picker that assigns an existing tag or mints one inline by
 * name (get-or-create server-side). Read-only without people.manage.
 */
import { useState } from 'react'
import { toast } from 'sonner'
import { XMarkIcon, PlusIcon } from '@heroicons/react/24/solid'
import type { PrincipalId, UserTagId } from '@quackback/ids'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MENU_ROW } from '@/components/ui/menu'
import { cn } from '@/lib/shared/utils'
import {
  useUserTags,
  useUserTagsForPrincipal,
  useAssignUserTag,
  useRemoveUserTag,
} from '@/lib/client/hooks/use-user-tags'

interface UserTagControlProps {
  principalId: PrincipalId
  canManage?: boolean
}

export function UserTagControl({ principalId, canManage = false }: UserTagControlProps) {
  const { data: assigned } = useUserTagsForPrincipal(principalId)
  const { data: allTags } = useUserTags()
  const assignTag = useAssignUserTag()
  const removeTag = useRemoveUserTag()
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [newName, setNewName] = useState('')

  const tags = assigned ?? []
  const assignedIds = new Set(tags.map((t) => t.id))
  const available = (allTags ?? []).filter((t) => !assignedIds.has(t.id))

  const handleAssign = (tagId: UserTagId, name: string) => {
    assignTag.mutate(
      { principalId, tagId },
      {
        onSuccess: () => {
          setPopoverOpen(false)
          toast.success(`Tagged ${name}`)
        },
        onError: () => toast.error(`Failed to add tag ${name}`),
      }
    )
  }

  const handleCreate = () => {
    const name = newName.trim()
    if (!name) return
    assignTag.mutate(
      { principalId, name },
      {
        onSuccess: () => {
          setNewName('')
          setPopoverOpen(false)
          toast.success(`Tagged ${name}`)
        },
        onError: () => toast.error(`Failed to add tag ${name}`),
      }
    )
  }

  const handleRemove = (tagId: UserTagId, name: string) => {
    removeTag.mutate(
      { principalId, tagId },
      { onError: () => toast.error(`Failed to remove tag ${name}`) }
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.length === 0 && !canManage && (
        <p className="text-sm text-muted-foreground/50 italic">No tags</p>
      )}
      {tags.map((tag) => (
        <span
          key={tag.id}
          className="group inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
          style={{
            backgroundColor: tag.color + '20',
            borderColor: tag.color + '40',
            color: tag.color,
          }}
        >
          <span>{tag.name}</span>
          {canManage && (
            <button
              type="button"
              onClick={() => handleRemove(tag.id, tag.name)}
              className="ml-0.5 opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-500"
              aria-label={`Remove tag ${tag.name}`}
            >
              <XMarkIcon className="h-3 w-3" />
            </button>
          )}
        </span>
      ))}
      {canManage && (
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs gap-1">
              <PlusIcon className="h-3 w-3" />
              Add tag
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-64 p-2">
            <div className="flex gap-1.5">
              <Input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="New tag name"
                className="h-8 text-sm"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleCreate()
                  }
                }}
              />
              <Button
                size="sm"
                className="h-8 shrink-0"
                onClick={handleCreate}
                disabled={!newName.trim() || assignTag.isPending}
              >
                Add
              </Button>
            </div>
            {available.length > 0 && (
              <div className="mt-1.5 max-h-48 overflow-y-auto">
                {available.map((tag) => (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => handleAssign(tag.id, tag.name)}
                    className={cn(MENU_ROW, 'w-full gap-2 hover:bg-muted')}
                  >
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: tag.color }}
                    />
                    <span className="truncate">{tag.name}</span>
                  </button>
                ))}
              </div>
            )}
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
