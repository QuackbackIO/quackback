import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  PlusIcon,
  MapIcon,
  EllipsisVerticalIcon,
  PencilIcon,
  TrashIcon,
  ArrowPathIcon,
  LockClosedIcon,
} from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { PageHeader } from '@/components/shared/page-header'
import { FilterSection } from '@/components/shared/filter-section'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { EmptyState } from '@/components/shared/empty-state'
import { cn, slugify } from '@/lib/shared/utils'
import { useRoadmaps } from '@/lib/client/hooks/use-roadmaps-query'
import { useCreateRoadmap, useUpdateRoadmap, useDeleteRoadmap } from '@/lib/client/mutations'
import type { RoadmapView } from '@/lib/client/hooks/use-roadmaps-query'
import { adminQueries } from '@/lib/client/queries/admin'
import { useSegments } from '@/lib/client/hooks/use-segments-queries'
import { RoadmapBuilderForm, type RoadmapBuilderValue } from './roadmap-builder-form'

interface RoadmapSidebarProps {
  selectedRoadmapId: string | null
  onSelectRoadmap: (roadmapId: string | null) => void
}

export function RoadmapSidebar({ selectedRoadmapId, onSelectRoadmap }: RoadmapSidebarProps) {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [editingRoadmap, setEditingRoadmap] = useState<RoadmapView | null>(null)
  const [deletingRoadmap, setDeletingRoadmap] = useState<RoadmapView | null>(null)

  const { data: roadmaps, isLoading } = useRoadmaps()
  const { data: statuses = [] } = useQuery(adminQueries.statuses())
  const { data: boards = [] } = useQuery(adminQueries.boards())
  const { data: tags = [] } = useQuery(adminQueries.tags())
  const { data: segments = [] } = useSegments()
  const createRoadmap = useCreateRoadmap()
  const updateRoadmap = useUpdateRoadmap()
  const deleteRoadmap = useDeleteRoadmap()

  const handleCreateSubmit = async (value: RoadmapBuilderValue) => {
    try {
      const newRoadmap = await createRoadmap.mutateAsync({
        ...value,
        slug: slugify(value.name),
      })
      setIsCreateDialogOpen(false)
      onSelectRoadmap(newRoadmap.id)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't create roadmap. Try again.")
    }
  }

  const handleEditSubmit = async (value: RoadmapBuilderValue) => {
    if (!editingRoadmap) return

    try {
      await updateRoadmap.mutateAsync({
        roadmapId: editingRoadmap.id,
        input: value,
      })
      setIsEditDialogOpen(false)
      setEditingRoadmap(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't update roadmap. Try again.")
    }
  }

  const handleDelete = async () => {
    if (!deletingRoadmap) return

    try {
      await deleteRoadmap.mutateAsync(deletingRoadmap.id)
      setIsDeleteDialogOpen(false)
      setDeletingRoadmap(null)
      if (selectedRoadmapId === deletingRoadmap.id) {
        onSelectRoadmap(roadmaps?.[0]?.id ?? null)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't delete roadmap. Try again.")
    }
  }

  const openEditDialog = (roadmap: RoadmapView) => {
    setEditingRoadmap(roadmap)
    setIsEditDialogOpen(true)
  }

  const openDeleteDialog = (roadmap: RoadmapView) => {
    setDeletingRoadmap(roadmap)
    setIsDeleteDialogOpen(true)
  }

  return (
    <aside className="w-64 xl:w-72 shrink-0 flex flex-col border-r border-border/50 bg-card/30 overflow-hidden">
      <div className="shrink-0 px-4 py-3.5">
        <PageHeader icon={MapIcon} title="Roadmap" />
      </div>

      {/* Selector + list — the "Roadmaps" subheading routes through the shared
          FilterSection (static label + create button in the action slot) so it
          matches every other admin left pane. */}
      <ScrollArea className="flex-1">
        <div className="px-5 pb-5">
          <FilterSection
            title="Roadmaps"
            collapsible={false}
            action={
              <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
                <DialogTrigger asChild>
                  <button
                    type="button"
                    className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    <PlusIcon className="h-3 w-3" />
                  </button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-3xl">
                  <DialogHeader>
                    <DialogTitle>Create Roadmap</DialogTitle>
                    <DialogDescription>
                      Define a saved view over posts using statuses or ETA periods.
                    </DialogDescription>
                  </DialogHeader>
                  <RoadmapBuilderForm
                    statuses={statuses}
                    boards={boards}
                    tags={tags}
                    segments={segments}
                    isPending={createRoadmap.isPending}
                    submitLabel="Create"
                    onCancel={() => setIsCreateDialogOpen(false)}
                    onSubmit={handleCreateSubmit}
                  />
                </DialogContent>
              </Dialog>
            }
          >
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <ArrowPathIcon className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : roadmaps?.length === 0 ? (
              <EmptyState
                icon={MapIcon}
                title="No roadmaps yet"
                description="Create your first roadmap to get started"
                className="py-12"
              />
            ) : (
              <div className="space-y-1">
                {roadmaps?.map((roadmap) => (
                  <div
                    key={roadmap.id}
                    className={cn(
                      'group flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-pointer font-normal transition-colors',
                      selectedRoadmapId === roadmap.id
                        ? 'bg-muted text-foreground font-medium'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    )}
                    onClick={() => onSelectRoadmap(roadmap.id)}
                  >
                    <MapIcon
                      className={cn(
                        'size-4 shrink-0',
                        selectedRoadmapId === roadmap.id ? 'text-primary' : ''
                      )}
                    />
                    <span className="flex-1 text-[13px] truncate">{roadmap.name}</span>
                    {roadmap.visibility !== 'public' && (
                      <LockClosedIcon className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                    )}
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 opacity-0 group-hover:opacity-100 -mr-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <EllipsisVerticalIcon className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEditDialog(roadmap)}>
                          <PencilIcon className="h-4 w-4 mr-2" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => openDeleteDialog(roadmap)}
                        >
                          <TrashIcon className="h-4 w-4 mr-2" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ))}
              </div>
            )}
          </FilterSection>
        </div>
      </ScrollArea>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit Roadmap</DialogTitle>
            <DialogDescription>Update your roadmap settings.</DialogDescription>
          </DialogHeader>
          {editingRoadmap && (
            <RoadmapBuilderForm
              key={editingRoadmap.id}
              roadmap={editingRoadmap}
              statuses={statuses}
              boards={boards}
              tags={tags}
              segments={segments}
              isPending={updateRoadmap.isPending}
              submitLabel="Save"
              onCancel={() => setIsEditDialogOpen(false)}
              onSubmit={handleEditSubmit}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        title="Delete Roadmap"
        description={`Are you sure you want to delete "${deletingRoadmap?.name}"? Posts are not changed because roadmap placement is derived from their fields.`}
        confirmLabel="Delete"
        variant="destructive"
        isPending={deleteRoadmap.isPending}
        onConfirm={handleDelete}
      />
    </aside>
  )
}
