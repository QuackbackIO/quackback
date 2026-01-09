import { useState } from 'react'
import { MapIcon, PlusIcon, CheckIcon, ArrowPathIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'
import { useRoadmaps } from '@/lib/hooks/use-roadmaps-query'
import { addPostToRoadmapFn, removePostFromRoadmapFn } from '@/lib/server-functions/roadmaps'
import type { PostStatusEntity } from '@/lib/db-types'
import type { PostId, RoadmapId } from '@quackback/ids'

interface AddToRoadmapDropdownProps {
  postId: PostId
  currentStatusId: string
  /** List of roadmap IDs this post is already on */
  currentRoadmapIds?: string[]
  statuses: PostStatusEntity[]
  onSuccess?: () => void
}

export function AddToRoadmapDropdown({
  postId,
  currentStatusId,
  currentRoadmapIds = [],
  statuses,
  onSuccess,
}: AddToRoadmapDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [pendingRoadmapId, setPendingRoadmapId] = useState<string | null>(null)

  const { data: roadmaps, isLoading: isLoadingRoadmaps } = useRoadmaps({
    enabled: isOpen,
  })

  // Get the first status with showOnRoadmap for default placement
  const _defaultStatusId = statuses.find((s) => s.showOnRoadmap)?.id ?? currentStatusId

  const isOnRoadmap = (roadmapId: string) => currentRoadmapIds.includes(roadmapId)

  const handleToggleRoadmap = async (roadmapId: string, isCurrentlyOn: boolean) => {
    setPendingRoadmapId(roadmapId)
    try {
      if (isCurrentlyOn) {
        await removePostFromRoadmapFn({
          data: {
            roadmapId: roadmapId as RoadmapId,
            postId,
          },
        })
      } else {
        await addPostToRoadmapFn({
          data: {
            roadmapId: roadmapId as RoadmapId,
            postId,
          },
        })
      }
      onSuccess?.()
    } catch (error) {
      console.error('Failed to toggle roadmap:', error)
    } finally {
      setPendingRoadmapId(null)
    }
  }

  const roadmapCount = currentRoadmapIds.length

  return (
    <DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <MapIcon className="h-3.5 w-3.5" />
          Add to roadmap
          {roadmapCount > 0 && (
            <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">
              {roadmapCount}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        {isLoadingRoadmaps ? (
          <div className="flex items-center justify-center py-4">
            <ArrowPathIcon className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : roadmaps && roadmaps.length > 0 ? (
          roadmaps.map((roadmap) => {
            const isOn = isOnRoadmap(roadmap.id)
            const isPending = pendingRoadmapId === roadmap.id
            return (
              <DropdownMenuItem
                key={roadmap.id}
                onClick={(e) => {
                  e.preventDefault()
                  handleToggleRoadmap(roadmap.id, isOn)
                }}
                disabled={isPending}
                className="flex items-center justify-between"
              >
                <span className="truncate">{roadmap.name}</span>
                {isPending ? (
                  <ArrowPathIcon className="h-4 w-4 animate-spin text-muted-foreground" />
                ) : isOn ? (
                  <CheckIcon className="h-4 w-4 text-primary" />
                ) : (
                  <PlusIcon className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100" />
                )}
              </DropdownMenuItem>
            )
          })
        ) : (
          <div className="px-2 py-4 text-center">
            <p className="text-sm text-muted-foreground">No roadmaps yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Create a roadmap in the Roadmap section
            </p>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
