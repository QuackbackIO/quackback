'use client'

import { useState } from 'react'
import { Plus, Map, MoreVertical, Pencil, Trash2, Loader2, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ScrollArea } from '@/components/ui/scroll-area'
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import {
  useRoadmaps,
  useCreateRoadmap,
  useUpdateRoadmap,
  useDeleteRoadmap,
} from '@/lib/hooks/use-roadmaps-query'
import type { Roadmap } from '@/lib/db'

interface RoadmapSidebarProps {
  selectedRoadmapId: string | null
  onSelectRoadmap: (roadmapId: string | null) => void
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function RoadmapSidebar({ selectedRoadmapId, onSelectRoadmap }: RoadmapSidebarProps) {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false)
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)
  const [editingRoadmap, setEditingRoadmap] = useState<Roadmap | null>(null)
  const [deletingRoadmap, setDeletingRoadmap] = useState<Roadmap | null>(null)

  const { data: roadmaps, isLoading } = useRoadmaps()
  const createRoadmap = useCreateRoadmap()
  const updateRoadmap = useUpdateRoadmap()
  const deleteRoadmap = useDeleteRoadmap()

  const handleCreateSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const formData = new FormData(e.currentTarget)
    const name = formData.get('name') as string
    const description = formData.get('description') as string
    const isPublic = formData.get('isPublic') === 'on'

    try {
      const newRoadmap = await createRoadmap.mutateAsync({
        name,
        slug: slugify(name),
        description: description || undefined,
        isPublic,
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

    const formData = new FormData(e.currentTarget)
    const name = formData.get('name') as string
    const description = formData.get('description') as string
    const isPublic = formData.get('isPublic') === 'on'

    try {
      await updateRoadmap.mutateAsync({
        roadmapId: editingRoadmap.id,
        input: {
          name,
          description,
          isPublic,
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
    setIsEditDialogOpen(true)
  }

  const openDeleteDialog = (roadmap: Roadmap) => {
    setDeletingRoadmap(roadmap)
    setIsDeleteDialogOpen(true)
  }

  return (
    <aside className="w-60 xl:w-64 shrink-0 flex flex-col border-r border-border/50 bg-card/50 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border/50">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Roadmaps
          </span>
          <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" className="h-7 w-7 -mr-1.5">
                <Plus className="h-4 w-4" />
              </Button>
            </DialogTrigger>
            <DialogContent>
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
                <div className="flex items-center space-x-2">
                  <Switch id="isPublic" name="isPublic" defaultChecked />
                  <Label htmlFor="isPublic">Public</Label>
                </div>
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsCreateDialogOpen(false)}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" disabled={createRoadmap.isPending}>
                    {createRoadmap.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                    Create
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* List */}
      <ScrollArea className="flex-1">
        <div className="p-2">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : roadmaps?.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 px-4 text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 mb-3">
                <Map className="h-5 w-5 text-primary" />
              </div>
              <p className="text-sm font-medium text-foreground">No roadmaps yet</p>
              <p className="text-xs text-muted-foreground mt-1">
                Create your first roadmap to get started
              </p>
            </div>
          ) : (
            <div className="space-y-0.5">
              {roadmaps?.map((roadmap) => (
                <div
                  key={roadmap.id}
                  className={cn(
                    'group flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-colors',
                    selectedRoadmapId === roadmap.id
                      ? 'bg-muted text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                  )}
                  onClick={() => onSelectRoadmap(roadmap.id)}
                >
                  <Map
                    className={cn(
                      'h-4 w-4 shrink-0',
                      selectedRoadmapId === roadmap.id ? 'text-primary' : ''
                    )}
                  />
                  <span className="flex-1 text-sm truncate">{roadmap.name}</span>
                  {!roadmap.isPublic && <Lock className="h-3 w-3 text-muted-foreground shrink-0" />}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 opacity-0 group-hover:opacity-100 -mr-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEditDialog(roadmap)}>
                        <Pencil className="h-4 w-4 mr-2" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => openDeleteDialog(roadmap)}
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Edit Dialog */}
      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
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
              <div className="flex items-center space-x-2">
                <Switch
                  id="edit-isPublic"
                  name="isPublic"
                  defaultChecked={editingRoadmap.isPublic}
                />
                <Label htmlFor="edit-isPublic">Public</Label>
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setIsEditDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={updateRoadmap.isPending}>
                  {updateRoadmap.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Save
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Roadmap</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deletingRoadmap?.name}"? This will remove all posts
              from this roadmap. The posts themselves will not be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteRoadmap.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  )
}
