import { useState, useEffect, useTransition, type ReactNode } from 'react'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import {
  PlusIcon,
  TrashIcon,
  PencilSquareIcon,
  ArrowPathIcon,
  EyeSlashIcon,
  GlobeAltIcon,
} from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Radio } from '@base-ui/react/radio'
import { RadioGroup } from '@/components/ui/radio-group'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { ColorPickerGrid, ColorHexInput, randomColor } from '@/components/shared/color-picker'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { cn } from '@/lib/shared/utils'
import type { PostTag } from '@/lib/shared/db-types'
import { createPostTagFn, updatePostTagFn, deletePostTagFn } from '@/lib/server/functions/post-tags'

function ColorPickerPopover({
  color,
  onColorChange,
  trigger,
}: {
  color: string
  onColorChange: (color: string) => void
  trigger: ReactNode
}) {
  return (
    <Popover>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="w-auto p-2 space-y-2" align="start">
        <ColorPickerGrid selectedColor={color} onColorChange={onColorChange} />
        <ColorHexInput color={color} onColorChange={onColorChange} />
      </PopoverContent>
    </Popover>
  )
}

// ============================================================================
// PostTag Dialog (Create + Edit)
// ============================================================================

interface TagDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tag: PostTag | null
  onSaved: (saved: PostTag) => void
}

function TagDialog({ open, onOpenChange, tag, onSaved }: TagDialogProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState('#6b7280')
  const [isPublic, setIsPublic] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const isEdit = tag !== null

  useEffect(() => {
    if (open) {
      if (tag) {
        setName(tag.name)
        setDescription(tag.description ?? '')
        setColor(tag.color)
        setIsPublic(tag.isPublic)
      } else {
        setName('')
        setDescription('')
        setColor(randomColor())
        setIsPublic(true)
      }
      setError(null)
    }
  }, [open, tag])

  async function handleSave() {
    const trimmedName = name.trim()
    if (!trimmedName) {
      setError('Name is required')
      return
    }
    if (trimmedName.length > 50) {
      setError('Name must be 50 characters or less')
      return
    }
    if (!/^#[0-9A-Fa-f]{6}$/.test(color)) {
      setError('Invalid color format')
      return
    }

    setIsSaving(true)
    setError(null)

    try {
      let saved: PostTag
      if (isEdit) {
        saved = await updatePostTagFn({
          data: {
            id: tag.id,
            name: trimmedName,
            color,
            description: description.trim() || null,
            isPublic,
          },
        })
      } else {
        saved = await createPostTagFn({
          data: {
            name: trimmedName,
            color,
            description: description.trim() || undefined,
            isPublic,
          },
        })
      }
      onSaved(saved)
      onOpenChange(false)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save tag'
      setError(message)
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" aria-describedby="tag-dialog-desc">
        <form
          onSubmit={(e) => {
            e.preventDefault()
            void handleSave()
          }}
        >
          <DialogHeader>
            <DialogTitle>{isEdit ? 'Edit tag' : 'New tag'}</DialogTitle>
            <DialogDescription id="tag-dialog-desc">
              Label posts for filtering. Visible on the portal unless marked internal.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="tag-name">Name</Label>
              <div className="flex items-center gap-2">
                <ColorPickerPopover
                  color={color}
                  onColorChange={setColor}
                  trigger={
                    <button
                      type="button"
                      className="h-9 w-9 rounded-full border border-border shrink-0 hover:ring-2 hover:ring-offset-1 hover:ring-muted-foreground/50 focus-visible:ring-2 focus-visible:ring-ring"
                      style={{ backgroundColor: color }}
                      aria-label="Color"
                      title="Change color"
                    />
                  }
                />
                <Input
                  id="tag-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. bug, enhancement, design"
                  maxLength={50}
                  autoFocus
                  className="flex-1 min-w-0"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label id="tag-visibility-label">Visibility</Label>
              <RadioGroup
                value={isPublic ? 'portal' : 'internal'}
                onValueChange={(value) => setIsPublic(value === 'portal')}
                aria-labelledby="tag-visibility-label"
                className="grid grid-cols-1 gap-2 sm:grid-cols-2"
              >
                <VisibilityCard
                  value="portal"
                  label="Portal"
                  description="Shown on the public portal"
                  icon={<GlobeAltIcon className="h-3.5 w-3.5" />}
                />
                <VisibilityCard
                  value="internal"
                  label="Internal"
                  description="Hidden from the portal"
                  icon={<EyeSlashIcon className="h-3.5 w-3.5" />}
                />
              </RadioGroup>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tag-desc">
                Description <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Textarea
                id="tag-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="When to use this tag"
                rows={2}
                maxLength={200}
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving || !name.trim()}>
              {isSaving ? 'Saving...' : isEdit ? 'Save changes' : 'Create tag'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function VisibilityCard({
  value,
  label,
  description,
  icon,
}: {
  value: string
  label: string
  description: string
  icon: ReactNode
}) {
  return (
    <Radio.Root
      value={value}
      aria-label={label}
      className={cn(
        'group flex flex-col items-stretch gap-1 rounded-lg border px-3 py-2.5 text-left transition-colors outline-none',
        'border-border bg-muted/30 hover:bg-muted/60 cursor-pointer',
        'focus-visible:ring-2 focus-visible:ring-ring/50',
        'data-checked:border-primary data-checked:bg-primary/10'
      )}
    >
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground group-data-checked:text-primary">{icon}</span>
        <span className="text-sm font-semibold group-data-checked:text-primary">{label}</span>
      </div>
      <span className="text-xs text-muted-foreground leading-snug">{description}</span>
    </Radio.Root>
  )
}

// ============================================================================
// PostTag List (main export)
// ============================================================================

interface TagListProps {
  initialTags: PostTag[]
}

export function TagList({ initialTags }: TagListProps) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [tags, setTags] = useState(initialTags)
  const [savingField, setSavingField] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingTag, setEditingTag] = useState<PostTag | null>(null)
  const [deletingTag, setDeletingTag] = useState<PostTag | null>(null)

  // Change color inline — save immediately
  const handleColorChange = async (tag: PostTag, color: string) => {
    const previousColor = tag.color
    setSavingField(`color-${tag.id}`)
    setTags((prev) => prev.map((t) => (t.id === tag.id ? { ...t, color } : t)))

    try {
      await updatePostTagFn({ data: { id: tag.id, color } })
      startTransition(() => router.invalidate())
    } catch {
      toast.error('Failed to update color')
      setTags((prev) => prev.map((t) => (t.id === tag.id ? { ...t, color: previousColor } : t)))
    } finally {
      setSavingField(null)
    }
  }

  function handleTagSaved(saved: PostTag) {
    if (editingTag) {
      setTags((prev) => prev.map((t) => (t.id === saved.id ? saved : t)))
    } else {
      setTags((prev) => [...prev, saved])
    }
    startTransition(() => router.invalidate())
  }

  function openCreate() {
    setEditingTag(null)
    setDialogOpen(true)
  }

  function openEdit(tag: PostTag) {
    setEditingTag(tag)
    setDialogOpen(true)
  }

  async function handleDelete() {
    if (!deletingTag) return
    try {
      await deletePostTagFn({ data: { id: deletingTag.id } })
      setTags((prev) => prev.filter((t) => t.id !== deletingTag.id))
      startTransition(() => router.invalidate())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to delete tag')
    } finally {
      setDeletingTag(null)
    }
  }

  return (
    <div className="space-y-8">
      <SettingsCard
        title="Tags"
        description="Label posts across boards for filtering and organization. Tags appear as colored badges throughout the app, and on the public portal unless marked internal."
        contentClassName="p-4"
      >
        <div className="space-y-1">
          {tags.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No tags yet. Create your first tag to get started.
            </p>
          )}

          {tags.map((tag) => (
            <div
              key={tag.id}
              className="flex items-center gap-2 sm:gap-3 py-1.5 px-2 rounded-md hover:bg-muted/50 group min-w-0"
            >
              <div className="min-w-0 max-w-[8rem] sm:w-40 sm:max-w-none sm:shrink-0">
                <ColorPickerPopover
                  color={tag.color}
                  onColorChange={(c) => handleColorChange(tag, c)}
                  trigger={
                    <button
                      type="button"
                      className="inline-flex items-center px-2 py-0.5 rounded-md text-sm font-medium max-w-full truncate hover:ring-2 hover:ring-offset-1 hover:ring-muted-foreground/40"
                      style={{ backgroundColor: tag.color + '20', color: tag.color }}
                      title="Change color"
                    >
                      {tag.name}
                    </button>
                  }
                />
              </div>

              <span
                className="inline-flex items-center gap-1 text-xs text-muted-foreground shrink-0 w-[4.75rem]"
                title={
                  tag.isPublic ? 'Shown on the public portal' : 'Hidden from the public portal'
                }
              >
                {tag.isPublic ? (
                  <GlobeAltIcon className="h-3 w-3" />
                ) : (
                  <EyeSlashIcon className="h-3 w-3" />
                )}
                {tag.isPublic ? 'Portal' : 'Internal'}
              </span>

              <span className="hidden sm:block text-xs text-muted-foreground truncate flex-1 min-w-0">
                {tag.description ?? ''}
              </span>

              {/* Saving spinner */}
              {savingField === `color-${tag.id}` && (
                <ArrowPathIcon className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
              )}

              {/* Edit button */}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-muted-foreground opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                onClick={() => openEdit(tag)}
                title="Edit tag"
              >
                <PencilSquareIcon className="h-3.5 w-3.5" />
              </Button>

              {/* Delete button */}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
                onClick={() => setDeletingTag(tag)}
                title="Delete tag"
              >
                <TrashIcon className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}

          {/* Add new tag button */}
          <button
            className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50 w-full text-muted-foreground"
            onClick={openCreate}
          >
            <PlusIcon className="h-3 w-3" />
            <span className="text-sm">Add new tag</span>
          </button>
        </div>
      </SettingsCard>

      {/* Create/Edit dialog */}
      <TagDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        tag={editingTag}
        onSaved={handleTagSaved}
      />

      {/* Delete confirmation */}
      <ConfirmDialog
        open={!!deletingTag}
        onOpenChange={() => setDeletingTag(null)}
        title="Delete tag"
        description={`Are you sure you want to delete "${deletingTag?.name}"? This will remove it from all posts.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  )
}
