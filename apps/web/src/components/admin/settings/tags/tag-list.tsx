import { useState, useEffect, useTransition } from 'react'
import { useRouter } from '@tanstack/react-router'
import { toast } from 'sonner'
import { PlusIcon, TrashIcon, PencilSquareIcon, ArrowPathIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { SettingsCard } from '@/components/admin/settings/settings-card'
import { cn } from '@/lib/shared/utils'
import type { Tag } from '@/lib/shared/db-types'
import { createTagFn, updateTagFn, deleteTagFn } from '@/lib/server/functions/tags'

// ============================================================================
// Constants
// ============================================================================

const PRESET_COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  '#f87171',
  '#fb923c',
  '#facc15',
  '#4ade80',
  '#2dd4bf',
  '#60a5fa',
  '#a78bfa',
  '#f472b6',
  '#b91c1c',
  '#c2410c',
  '#a16207',
  '#15803d',
  '#0f766e',
  '#1d4ed8',
  '#6d28d9',
  '#be185d',
  '#0f172a',
  '#334155',
  '#64748b',
  '#94a3b8',
  '#475569',
  '#1e293b',
  '#78716c',
  '#a8a29e',
]

function randomColor(): string {
  return (
    '#' +
    Math.floor(Math.random() * 0xffffff)
      .toString(16)
      .padStart(6, '0')
  )
}

// ============================================================================
// Color Picker Components
// ============================================================================

function ColorPickerGrid({
  selectedColor,
  onColorChange,
}: {
  selectedColor: string
  onColorChange: (color: string) => void
}) {
  return (
    <div className="grid grid-cols-8 gap-1.5">
      {PRESET_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          className={cn(
            'h-6 w-6 rounded-full border-2 transition-colors',
            selectedColor.toLowerCase() === c.toLowerCase()
              ? 'border-foreground'
              : 'border-transparent'
          )}
          style={{ backgroundColor: c }}
          onClick={() => onColorChange(c)}
        />
      ))}
    </div>
  )
}

function ColorHexInput({
  color,
  onColorChange,
}: {
  color: string
  onColorChange: (color: string) => void
}) {
  const [hexInput, setHexInput] = useState(color)

  useEffect(() => {
    setHexInput(color)
  }, [color])

  function handleHexChange(value: string) {
    setHexInput(value)
    if (/^#[0-9A-Fa-f]{6}$/.test(value)) {
      onColorChange(value)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <span
        className="h-6 w-6 rounded-md border border-border shrink-0"
        style={{ backgroundColor: color }}
      />
      <Input
        value={hexInput}
        onChange={(e) => handleHexChange(e.target.value)}
        className="font-mono text-xs h-7"
        placeholder="#000000"
      />
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-7 w-7 shrink-0"
        onClick={() => {
          const c = randomColor()
          setHexInput(c)
          onColorChange(c)
        }}
        title="Random color"
      >
        <ArrowPathIcon className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

// ============================================================================
// Tag Dialog (Create + Edit)
// ============================================================================

interface TagDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tag: Tag | null
  onSaved: () => void
}

function TagDialog({ open, onOpenChange, tag, onSaved }: TagDialogProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState('#6b7280')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const isEdit = tag !== null

  useEffect(() => {
    if (open) {
      if (tag) {
        setName(tag.name)
        setDescription(tag.description ?? '')
        setColor(tag.color)
      } else {
        setName('')
        setDescription('')
        setColor(randomColor())
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
      if (isEdit) {
        await updateTagFn({
          data: {
            id: tag.id,
            name: trimmedName,
            color,
            description: description.trim() || null,
          },
        })
      } else {
        await createTagFn({
          data: {
            name: trimmedName,
            color,
            description: description.trim() || undefined,
          },
        })
      }
      onSaved()
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
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit tag' : 'New tag'}</DialogTitle>
        </DialogHeader>

        {/* Live preview */}
        <div className="flex justify-center py-3 bg-muted/30 rounded-lg">
          <span
            className="inline-flex items-center px-3 py-0.5 rounded-md text-sm font-medium"
            style={{ backgroundColor: color + '20', color }}
          >
            {name.trim() || 'Tag name'}
          </span>
        </div>

        <div className="space-y-2">
          <Label htmlFor="tag-name">Name</Label>
          <Input
            id="tag-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. bug, enhancement, design"
            maxLength={50}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="tag-desc">
            Description <span className="text-muted-foreground font-normal">(optional)</span>
          </Label>
          <Textarea
            id="tag-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Brief description of when to use this tag"
            rows={2}
            maxLength={200}
          />
        </div>

        <div className="space-y-2">
          <Label>Color</Label>
          <ColorPickerGrid selectedColor={color} onColorChange={setColor} />
          <ColorHexInput color={color} onColorChange={setColor} />
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving}>
            {isSaving ? 'Saving...' : isEdit ? 'Save changes' : 'Create tag'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ============================================================================
// Tag List (main export)
// ============================================================================

interface TagListProps {
  initialTags: Tag[]
}

export function TagList({ initialTags }: TagListProps) {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [tags, setTags] = useState(initialTags)
  const [savingField, setSavingField] = useState<string | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingTag, setEditingTag] = useState<Tag | null>(null)
  const [deletingTag, setDeletingTag] = useState<Tag | null>(null)

  // Change color inline — save immediately
  const handleColorChange = async (tag: Tag, color: string) => {
    const previousColor = tag.color
    setSavingField(`color-${tag.id}`)
    setTags((prev) => prev.map((t) => (t.id === tag.id ? { ...t, color } : t)))

    try {
      await updateTagFn({ data: { id: tag.id, color } })
      startTransition(() => router.invalidate())
    } catch {
      toast.error('Failed to update color')
      setTags((prev) => prev.map((t) => (t.id === tag.id ? { ...t, color: previousColor } : t)))
    } finally {
      setSavingField(null)
    }
  }

  function handleTagSaved() {
    startTransition(() => router.invalidate())
    // Refetch by invalidating — the route loader will re-run
  }

  function openCreate() {
    setEditingTag(null)
    setDialogOpen(true)
  }

  function openEdit(tag: Tag) {
    setEditingTag(tag)
    setDialogOpen(true)
  }

  async function handleDelete() {
    if (!deletingTag) return
    try {
      await deleteTagFn({ data: { id: deletingTag.id } })
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
        description="Label posts across boards for filtering and organization. Tags appear as colored badges throughout the app."
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
              className="flex items-center gap-2 py-1.5 px-2 rounded-md hover:bg-muted/50 group"
            >
              {/* Color dot with popover */}
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    className="h-3 w-3 rounded-full shrink-0 cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-muted-foreground/50"
                    style={{ backgroundColor: tag.color }}
                  />
                </PopoverTrigger>
                <PopoverContent className="w-auto p-2 space-y-2" align="start">
                  <ColorPickerGrid
                    selectedColor={tag.color}
                    onColorChange={(c) => handleColorChange(tag, c)}
                  />
                  <ColorHexInput
                    color={tag.color}
                    onColorChange={(c) => handleColorChange(tag, c)}
                  />
                </PopoverContent>
              </Popover>

              {/* Name */}
              <span className="text-sm font-medium">{tag.name}</span>

              {/* Description */}
              <span className="text-xs text-muted-foreground truncate flex-1">
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
                className="h-7 w-7 text-muted-foreground opacity-0 group-hover:opacity-100"
                onClick={() => openEdit(tag)}
                title="Edit tag"
              >
                <PencilSquareIcon className="h-3.5 w-3.5" />
              </Button>

              {/* Delete button */}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100"
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
