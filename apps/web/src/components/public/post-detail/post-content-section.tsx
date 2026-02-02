'use client'

import { useCallback, useEffect, useState } from 'react'
import type { JSONContent } from '@tiptap/react'
import { PostContent } from '@/components/public/post-content'
import { Button } from '@/components/ui/button'
import { RichTextEditor, richTextToPlainText } from '@/components/ui/rich-text-editor'
import { Skeleton } from '@/components/ui/skeleton'
import { StatusBadge } from '@/components/ui/status-badge'
import type { EditPostInput } from '@/lib/client/mutations'
import type { PublicPostDetailView } from '@/lib/client/queries/portal-detail'
import { PostActionsMenu } from './post-actions-menu'

export function PostContentSectionSkeleton(): React.ReactElement {
  return (
    <div className="flex-1 p-6">
      <Skeleton className="h-5 w-20 mb-3 rounded-full" />
      <Skeleton className="h-7 w-3/4 mb-2" />
      <div className="flex items-center gap-2 mb-4">
        <Skeleton className="h-6 w-6 rounded-full" />
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-4 w-16" />
      </div>
      <div className="flex gap-1.5 mb-4">
        <Skeleton className="h-5 w-14 rounded-full" />
        <Skeleton className="h-5 w-18 rounded-full" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-5/6" />
        <Skeleton className="h-4 w-4/5" />
      </div>
    </div>
  )
}

interface PostContentSectionProps {
  post: PublicPostDetailView
  currentStatus?: { name: string; color: string | null }
  authorAvatarUrl?: string | null
  // Post actions (optional - only shown to post author)
  canEdit?: boolean
  canDelete?: boolean
  editReason?: string | null
  deleteReason?: string | null
  onDelete?: () => void
  // Inline editing
  isEditing?: boolean
  onEditStart?: () => void
  onEditSave?: (data: EditPostInput) => void
  onEditCancel?: () => void
  isSaving?: boolean
}

export function PostContentSection({
  post,
  currentStatus,
  authorAvatarUrl: _authorAvatarUrl,
  canEdit,
  canDelete,
  editReason,
  deleteReason,
  onDelete,
  isEditing = false,
  onEditStart,
  onEditSave,
  onEditCancel,
  isSaving = false,
}: PostContentSectionProps): React.ReactElement {
  const [editTitle, setEditTitle] = useState(post.title)
  const [editContentJson, setEditContentJson] = useState<JSONContent | null>(
    (post.contentJson as JSONContent) ?? null
  )

  useEffect(() => {
    if (isEditing) {
      setEditTitle(post.title)
      setEditContentJson((post.contentJson as JSONContent) ?? null)
    }
  }, [isEditing, post.title, post.contentJson])

  const showActionsMenu = (canEdit || canDelete) && onEditStart && onDelete && !isEditing

  const handleContentChange = useCallback((json: JSONContent) => {
    setEditContentJson(json)
  }, [])

  function handleSave(): void {
    if (!editTitle.trim() || !onEditSave) return

    const plainText = editContentJson ? richTextToPlainText(editContentJson) : ''
    onEditSave({
      title: editTitle.trim(),
      content: plainText,
      contentJson: editContentJson ?? undefined,
    })
  }

  function handleKeyDown(e: React.KeyboardEvent): void {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSave()
    }
    if (e.key === 'Escape' && onEditCancel) {
      onEditCancel()
    }
  }

  const isValid = editTitle.trim().length > 0
  const currentPlainText = editContentJson ? richTextToPlainText(editContentJson) : ''
  const originalPlainText = post.contentJson
    ? richTextToPlainText(post.contentJson as JSONContent)
    : post.content
  const hasChanges = editTitle !== post.title || currentPlainText !== originalPlainText

  // When editing, use a different layout with footer
  if (isEditing) {
    return (
      <div className="flex-1 flex flex-col">
        <div className="flex-1 p-6 pb-4" onKeyDown={handleKeyDown}>
          {/* Header with status */}
          <div className="flex items-start justify-between gap-2 mb-3">
            {currentStatus ? (
              <StatusBadge name={currentStatus.name} color={currentStatus.color} />
            ) : (
              <div />
            )}
          </div>

          {/* Title input */}
          <input
            type="text"
            value={editTitle}
            onChange={(e) => setEditTitle(e.target.value)}
            placeholder="What's your idea?"
            maxLength={200}
            autoFocus
            disabled={isSaving}
            className="w-full bg-transparent border-0 outline-none text-xl font-semibold text-foreground placeholder:text-muted-foreground/60 placeholder:font-normal caret-primary mb-2"
          />

          {/* Rich text editor */}
          <RichTextEditor
            value={editContentJson || ''}
            onChange={handleContentChange}
            placeholder="Add more details..."
            minHeight="150px"
            disabled={isSaving}
            borderless
          />
        </div>

        {/* Footer with actions */}
        <div className="flex items-center justify-end gap-2 px-6 py-3 border-t bg-muted/30">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onEditCancel}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={!isValid || !hasChanges || isSaving}>
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex-1 p-6 animate-in fade-in duration-300 fill-mode-backwards">
      <div className="flex items-start justify-between gap-2 mb-3">
        {currentStatus ? (
          <StatusBadge name={currentStatus.name} color={currentStatus.color} />
        ) : (
          <div />
        )}
        {showActionsMenu && (
          <PostActionsMenu
            canEdit={canEdit ?? false}
            canDelete={canDelete ?? false}
            editReason={editReason}
            deleteReason={deleteReason}
            onEdit={onEditStart}
            onDelete={onDelete}
          />
        )}
      </div>

      <h1 className="text-xl sm:text-2xl font-semibold text-foreground mb-4">{post.title}</h1>

      <PostContent
        content={post.content}
        contentJson={post.contentJson}
        className="prose prose-sm prose-neutral dark:prose-invert max-w-none text-foreground/90"
      />
    </div>
  )
}
