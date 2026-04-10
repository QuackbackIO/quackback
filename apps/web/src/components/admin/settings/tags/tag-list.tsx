import { useState, useCallback, useRef, useEffect, useTransition } from 'react'
import { useRouter } from '@tanstack/react-router'
import { useInfiniteQuery } from '@tanstack/react-query'
import {
  PlusIcon,
  MagnifyingGlassIcon,
  EllipsisVerticalIcon,
  PencilSquareIcon,
  TrashIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/solid'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/components/shared/confirm-dialog'
import { cn } from '@/lib/shared/utils'
import type { Tag } from '@/lib/shared/db-types'
import {
  createTagFn,
  updateTagFn,
  deleteTagFn,
  fetchTagsPaginatedFn,
} from '@/lib/server/functions/tags'

// ============================================================================
// Constants
// ============================================================================

const PRESET_COLORS = [
  // Row 1 - Vibrant
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
  // Row 2 - Muted
  '#f87171',
  '#fb923c',
  '#facc15',
  '#4ade80',
  '#2dd4bf',
  '#60a5fa',
  '#a78bfa',
  '#f472b6',
  // Row 3 - Dark
  '#b91c1c',
  '#c2410c',
  '#a16207',
  '#15803d',
  '#0f766e',
  '#1d4ed8',
  '#6d28d9',
  '#be185d',
  // Row 4 - Neutrals
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
// Color Picker
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

// ============================================================================
// Tag Dialog (Create + Edit)
// ============================================================================

interface TagDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  tag: Tag | null // null = create mode
  onSaved: () => void
}

function TagDialog({ open, onOpenChange, tag, onSaved }: TagDialogProps) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState('#6b7280')
  const [hexInput, setHexInput] = useState('#6b7280')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const isEdit = tag !== null

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      if (tag) {
        setName(tag.name)
        setDescription(tag.description ?? '')
        setColor(tag.color)
        setHexInput(tag.color)
      } else {
        const c = randomColor()
        setName('')
        setDescription('')
        setColor(c)
        setHexInput(c)
      }
      setError(null)
    }
  }, [open, tag])

  function handleHexChange(value: string) {
    setHexInput(value)
    if (/^#[0-9A-Fa-f]{6}$/.test(value)) {
      setColor(value)
    }
  }

  function handlePresetChange(c: string) {
    setColor(c)
    setHexInput(c)
  }

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
            style={{
              backgroundColor: color + '20',
              color: color,
            }}
          >
            {name.trim() || 'Tag name'}
          </span>
        </div>

        {/* Name */}
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

        {/* Description */}
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

        {/* Color */}
        <div className="space-y-2">
          <Label>Color</Label>
          <ColorPickerGrid selectedColor={color} onColorChange={handlePresetChange} />
          <div className="flex items-center gap-2 mt-2">
            <span
              className="h-7 w-7 rounded-md border border-border shrink-0"
              style={{ backgroundColor: color }}
            />
            <Input
              value={hexInput}
              onChange={(e) => handleHexChange(e.target.value)}
              className="font-mono text-sm"
              placeholder="#000000"
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const c = randomColor()
                setColor(c)
                setHexInput(c)
              }}
              title="Random color"
            >
              <ArrowPathIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Error */}
        {error && <p className="text-sm text-destructive">{error}</p>}

        {/* Actions */}
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

export function TagList() {
  const router = useRouter()
  const [, startTransition] = useTransition()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingTag, setEditingTag] = useState<Tag | null>(null)
  const [deletingTag, setDeletingTag] = useState<Tag | null>(null)
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null)

  // Debounce search
  const handleSearchChange = useCallback((value: string) => {
    setSearch(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedSearch(value), 300)
  }, [])

  // Infinite query
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, refetch } =
    useInfiniteQuery({
      queryKey: ['admin', 'tags', 'paginated', debouncedSearch],
      queryFn: ({ pageParam }) =>
        fetchTagsPaginatedFn({
          data: {
            cursor: pageParam,
            limit: 20,
            search: debouncedSearch || undefined,
          },
        }),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage) => {
        if (!lastPage.hasMore || lastPage.items.length === 0) return undefined
        return lastPage.items[lastPage.items.length - 1].name
      },
    })

  // IntersectionObserver for infinite scroll
  useEffect(() => {
    const el = loadMoreRef.current
    if (!el) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage()
        }
      },
      { threshold: 0.1 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const allTags = data?.pages.flatMap((p) => p.items) ?? []
  const totalCount = `${allTags.length}${hasNextPage ? '+' : ''}`

  function handleTagSaved() {
    refetch()
    startTransition(() => router.invalidate())
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
      setDeletingTag(null)
      refetch()
      startTransition(() => router.invalidate())
    } catch (err) {
      console.error('[tags] delete failed:', err)
    }
  }

  return (
    <div className="space-y-4">
      {/* Search + New button */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search tags..."
            className="pl-9"
          />
        </div>
        <Button onClick={openCreate}>
          <PlusIcon className="h-4 w-4 mr-1.5" />
          New tag
        </Button>
      </div>

      {/* Count */}
      {!isLoading && (
        <p className="text-xs text-muted-foreground px-1">
          {totalCount} tag{allTags.length !== 1 ? 's' : ''}
        </p>
      )}

      {/* Tag rows */}
      {isLoading ? (
        <div className="text-sm text-muted-foreground text-center py-12">Loading tags...</div>
      ) : allTags.length === 0 ? (
        <div className="text-sm text-muted-foreground text-center py-12">
          {debouncedSearch ? 'No tags match your search' : 'No tags yet. Create your first tag!'}
        </div>
      ) : (
        <div className="border rounded-lg divide-y">
          {allTags.map((tag) => (
            <div
              key={tag.id}
              className="flex items-center gap-3 px-4 py-3 hover:bg-muted/30 transition-colors cursor-pointer group"
              onClick={() => openEdit(tag)}
            >
              {/* Colored badge */}
              <span
                className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium shrink-0"
                style={{
                  backgroundColor: tag.color + '20',
                  color: tag.color,
                }}
              >
                {tag.name}
              </span>

              {/* Description */}
              <span className="text-xs text-muted-foreground truncate flex-1">
                {tag.description ?? ''}
              </span>

              {/* Actions menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-muted transition-all"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <EllipsisVerticalIcon className="h-4 w-4 text-muted-foreground" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation()
                      openEdit(tag)
                    }}
                  >
                    <PencilSquareIcon className="h-3.5 w-3.5 mr-2" />
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={(e) => {
                      e.stopPropagation()
                      setDeletingTag(tag)
                    }}
                  >
                    <TrashIcon className="h-3.5 w-3.5 mr-2" />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      )}

      {/* Infinite scroll sentinel */}
      <div ref={loadMoreRef} className="h-1" />
      {isFetchingNextPage && (
        <p className="text-xs text-muted-foreground text-center py-2">Loading more...</p>
      )}

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
