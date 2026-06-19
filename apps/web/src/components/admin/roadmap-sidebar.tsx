import { useState } from 'react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { RoadmapAccessControl } from '@/components/admin/roadmaps/roadmap-access-control'
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
import type { Roadmap, RoadmapAccess } from '@/lib/shared/db-types'
import { DEFAULT_ROADMAP_ACCESS } from '@/lib/shared/db-types'

/** A roadmap with the segments allowlist filled but hidden behind a non-segments
 *  tier is still valid; the only invalid state is segments + empty list. */
function isAccessValid(access: RoadmapAccess): boolean {
  return access.view !== 'segments' || access.segments.view.length > 0
}

interface RoadmapSidebarProps {
  selectedRoadmapId: string | null
  onSelectRoadmap: (roadmapId: string | null) => void
}

export function RoadmapSidebar({ selectedRoadmapId, onSelectRoadmap }: RoadmapSidebarProps) {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [editingRoadmap, setEditingRoadmap] = useState<Roadmap | null>(null)
  const [deletingRoadmap, setDeletingRoadmap] = useState<Roadmap | null>(null)
  // Visibility is a controlled value (the segments allowlist can't be captured
  // by uncontrolled FormData). Name/description stay on FormData.
  const [createAccess, setCreateAccess] = useState<RoadmapAccess>(DEFAULT_ROADMAP_ACCESS)
  const [editAccess, setEditAccess] = useState<RoadmapAccess>(DEFAULT_ROADMAP_ACCESS)

  const { data: roadmaps, isLoading } = useRoadmaps()
  const createRoadmap = useCreateRoadmap()
  const updateRoadmap = useUpdateRoadmap()
  const deleteRoadmap = useDeleteRoadmap()

  const handleCreateSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!isAccessValid(createAccess)) return
    const formData = new FormData(e.currentTarget)
    const name = formData.get('name') as string
    const description = formData.get('description') as string

    try {
      const newRoadmap = await createRoadmap.mutateAsync({
        name,
        slug: slugify(name),
        description: description || undefined,
        access: createAccess,
      })
      setIsCreateDialogOpen(false)
      onSelectRoadmap(newRoadmap.id)
    } catch (error) {
      console.error('Failed to create roadmap:', error)
    }
  }

  const handleEditSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!editingRoadmap) return
    if (!isAccessValid(editAccess)) return

    const formData = new FormData(e.currentTarget)
    const name = formData.get('name') as string
    const description = formData.get('description') as string

    try {
      await updateRoadmap.mutateAsync({
        roadmapId: editingRoadmap.id,
        input: {
          name,
          description,
          access: editAccess,
        },
      })
      setIsEditDialogOpen(false)
      setEditingRoadmap(null)
    } catch (error) {
      console.error('Failed to update roadmap:', error)
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
      console.error('Failed to delete roadmap:', error)
    }
  }

  const openEditDialog = (roadmap: Roadmap) => {
    setEditingRoadmap(roadmap)
    setEditAccess(roadmap.access)
    setIsEditDialogOpen(true)
  }

  const openDeleteDialog = (roadmap: Roadmap) => {
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
              <Dialog
                open={isCreateDialogOpen}
                onOpenChange={(open) => {
                  setIsCreateDialogOpen(open)
                  if (open) setCreateAccess(DEFAULT_ROADMAP_ACCESS)
                }}
              >
                <DialogTrigger asChild>
                  <button
                    type="button"
                    className="h-5 w-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    <PlusIcon className="h-3 w-3" />
                  </button>
                </DialogTrigger>
                <DialogContent className="sm:max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Create Roadmap</DialogTitle>
                    <DialogDescription>
                      Create a new roadmap to organize your posts into a public timeline.
                    </DialogDescription>
                  </DialogHeader>
                  <form onSubmit={handleCreateSubmit} className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="name">Name</Label>
                      <Input id="name" name="name" placeholder="Product Roadmap" required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="description">Description (optional)</Label>
                      <Input
                        id="description"
                        name="description"
                        placeholder="Our upcoming features and improvements"
                      />
                    </div>
                    <RoadmapAccessControl value={createAccess} onChange={setCreateAccess} />
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setIsCreateDialogOpen(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="submit"
                        disabled={createRoadmap.isPending || !isAccessValid(createAccess)}
                      >
                        {createRoadmap.isPending && (
                          <ArrowPathIcon className="h-4 w-4 mr-2 animate-spin" />
                        )}
                        Create
                      </Button>
                    </div>
                  </form>
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
                      'group flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-pointer font-medium transition-colors',
                      selectedRoadmapId === roadmap.id
                        ? 'bg-muted text-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    )}
                    onClick={() => onSelectRoadmap(roadmap.id)}
                  >
                    <MapIcon
                      className={cn(
                        'h-3.5 w-3.5 shrink-0',
                        selectedRoadmapId === roadmap.id ? 'text-primary' : ''
                      )}
                    />
                    <span className="flex-1 text-xs truncate">{roadmap.name}</span>
                    {roadmap.access.view !== 'anonymous' && (
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
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Roadmap</DialogTitle>
            <DialogDescription>Update your roadmap settings.</DialogDescription>
          </DialogHeader>
          {editingRoadmap && (
            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-name">Name</Label>
                <Input id="edit-name" name="name" defaultValue={editingRoadmap.name} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-description">Description (optional)</Label>
                <Input
                  id="edit-description"
                  name="description"
                  defaultValue={editingRoadmap.description || ''}
                />
              </div>
              <RoadmapAccessControl value={editAccess} onChange={setEditAccess} />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={updateRoadmap.isPending || !isAccessValid(editAccess)}
                >
                  {updateRoadmap.isPending && (
                    <ArrowPathIcon className="h-4 w-4 mr-2 animate-spin" />
                  )}
                  Save
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <ConfirmDialog
        open={isDeleteDialogOpen}
        onOpenChange={setIsDeleteDialogOpen}
        title="Delete Roadmap"
        description={`Are you sure you want to delete "${deletingRoadmap?.name}"? This will remove all posts from this roadmap. The posts themselves will not be deleted.`}
        confirmLabel="Delete"
        variant="destructive"
        isPending={deleteRoadmap.isPending}
        onConfirm={handleDelete}
      />
    </aside>
  )
}
