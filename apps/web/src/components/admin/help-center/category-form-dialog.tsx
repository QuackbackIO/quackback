import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { useCreateCategory, useUpdateCategory } from '@/lib/client/mutations/help-center'
import type { HelpCenterCategoryId } from '@quackback/ids'

const CATEGORY_EMOJIS = [
  '📁',
  '📂',
  '📚',
  '📖',
  '📝',
  '📋',
  '📌',
  '📎',
  '💡',
  '⚡',
  '🔧',
  '🛠️',
  '⚙️',
  '🔑',
  '🔒',
  '🔓',
  '🚀',
  '🎯',
  '✅',
  '❓',
  '💬',
  '📣',
  '📢',
  '🔔',
  '💰',
  '💳',
  '🏷️',
  '📊',
  '📈',
  '🗂️',
  '🗃️',
  '📦',
  '🌐',
  '🔗',
  '🖥️',
  '📱',
  '🎨',
  '🧩',
  '🔍',
  '📡',
  '👤',
  '👥',
  '🏢',
  '🎓',
  '📅',
  '⏰',
  '🛡️',
  '🧪',
] as const

const DEFAULT_EMOJI = '📁'

interface CategoryFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialValues?: {
    id: HelpCenterCategoryId
    name: string
    description: string | null
    icon: string | null
    isPublic: boolean
  }
  onCreated?: (categoryId: string) => void
}

export function CategoryFormDialog({
  open,
  onOpenChange,
  initialValues,
  onCreated,
}: CategoryFormDialogProps) {
  const isEdit = !!initialValues
  const createCategory = useCreateCategory()
  const updateCategory = useUpdateCategory()

  const [icon, setIcon] = useState(DEFAULT_EMOJI)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isPublic, setIsPublic] = useState(true)
  const [emojiOpen, setEmojiOpen] = useState(false)

  useEffect(() => {
    if (open) {
      setIcon(initialValues?.icon || DEFAULT_EMOJI)
      setName(initialValues?.name || '')
      setDescription(initialValues?.description || '')
      setIsPublic(initialValues?.isPublic ?? true)
    }
  }, [open, initialValues])

  const isPending = createCategory.isPending || updateCategory.isPending

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return

    if (isEdit) {
      await updateCategory.mutateAsync({
        id: initialValues.id,
        name: name.trim(),
        description: description.trim() || null,
        icon,
        isPublic,
      })
    } else {
      const result = await createCategory.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        icon,
        isPublic,
      })
      onCreated?.(result.id)
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Edit category' : 'New category'}</DialogTitle>
          <DialogDescription>
            {isEdit ? 'Update category details.' : 'Create a new help center category.'}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="category-name">Name</Label>
            <div className="flex items-center gap-2">
              <Popover open={emojiOpen} onOpenChange={setEmojiOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="h-9 w-9 rounded-md border border-border/50 flex items-center justify-center text-lg hover:bg-muted transition-colors shrink-0"
                  >
                    {icon}
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-2" align="start">
                  <div className="grid grid-cols-8 gap-1">
                    {CATEGORY_EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        type="button"
                        className="h-8 w-8 rounded-md hover:bg-muted flex items-center justify-center text-lg transition-colors"
                        onClick={() => {
                          setIcon(emoji)
                          setEmojiOpen(false)
                        }}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
              <Input
                id="category-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Getting Started"
                required
                className="flex-1"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="category-description">Description</Label>
            <Input
              id="category-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional short description"
            />
          </div>

          <div className="flex items-center justify-between">
            <div>
              <Label>Public</Label>
              <p className="text-xs text-muted-foreground">Visible on your public help center</p>
            </div>
            <Switch checked={isPublic} onCheckedChange={setIsPublic} />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending || !name.trim()}>
              {isPending ? (isEdit ? 'Saving...' : 'Creating...') : isEdit ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
