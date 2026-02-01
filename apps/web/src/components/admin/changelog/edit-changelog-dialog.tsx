'use client'

import { useState, useCallback, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useQuery } from '@tanstack/react-query'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { updateChangelogSchema } from '@/lib/shared/schemas/changelog'
import { useUpdateChangelog } from '@/lib/client/mutations/changelog'
import { changelogQueries } from '@/lib/client/queries/changelog'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { richTextToPlainText } from '@/components/ui/rich-text-editor'
import type { JSONContent } from '@tiptap/react'
import type { ChangelogId, PostId } from '@quackback/ids'
import { Form } from '@/components/ui/form'
import { ChangelogFormFields } from './changelog-form-fields'
import { type PublishState } from './publish-controls'

interface EditChangelogDialogProps {
  id: ChangelogId
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Converts server status and publishedAt to a PublishState for the form.
 */
function toPublishState(
  status: 'draft' | 'scheduled' | 'published',
  publishedAt: string | null
): PublishState {
  switch (status) {
    case 'draft':
      return { type: 'draft' }
    case 'scheduled':
      return { type: 'scheduled', publishAt: publishedAt ? new Date(publishedAt) : new Date() }
    case 'published':
      return { type: 'published' }
  }
}

export function EditChangelogDialog({ id, open, onOpenChange }: EditChangelogDialogProps) {
  const [contentJson, setContentJson] = useState<JSONContent | null>(null)
  const [linkedPostIds, setLinkedPostIds] = useState<PostId[]>([])
  const [publishState, setPublishState] = useState<PublishState>({ type: 'draft' })
  const [hasInitialized, setHasInitialized] = useState(false)

  const updateChangelogMutation = useUpdateChangelog()

  // Fetch existing changelog data
  const { data: entry, isLoading } = useQuery({
    ...changelogQueries.detail(id),
    enabled: open,
  })

  const form = useForm({
    resolver: standardSchemaResolver(updateChangelogSchema),
    defaultValues: {
      id: id as string,
      title: '',
      content: '',
      linkedPostIds: [] as string[],
      publishState: { type: 'draft' as const },
    },
  })

  // Initialize form with fetched data
  useEffect(() => {
    if (entry && !hasInitialized) {
      form.setValue('title', entry.title)
      form.setValue('content', entry.content)
      setContentJson(entry.contentJson as JSONContent | null)
      setLinkedPostIds(entry.linkedPosts.map((p) => p.id))
      setPublishState(toPublishState(entry.status, entry.publishedAt))
      setHasInitialized(true)
    }
  }, [entry, form, hasInitialized])

  // Reset initialization flag when dialog closes
  useEffect(() => {
    if (!open) {
      setHasInitialized(false)
    }
  }, [open])

  const handleContentChange = useCallback(
    (json: JSONContent) => {
      setContentJson(json)
      const plainText = richTextToPlainText(json)
      form.setValue('content', plainText, { shouldValidate: true })
    },
    [form]
  )

  const handleSubmit = form.handleSubmit((data) => {
    updateChangelogMutation.mutate(
      {
        id,
        title: data.title,
        content: data.content,
        contentJson,
        linkedPostIds,
        publishState,
      },
      {
        onSuccess: () => {
          onOpenChange(false)
        },
      }
    )
  })

  function handleOpenChange(isOpen: boolean) {
    onOpenChange(isOpen)
    if (!isOpen) {
      form.reset()
      setContentJson(null)
      setLinkedPostIds([])
      setPublishState({ type: 'draft' })
      updateChangelogMutation.reset()
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Submit on Cmd/Ctrl + Enter
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
  }

  const getSubmitButtonText = () => {
    if (updateChangelogMutation.isPending) {
      return publishState.type === 'published' ? 'Publishing...' : 'Saving...'
    }
    switch (publishState.type) {
      case 'draft':
        return 'Save Draft'
      case 'scheduled':
        return 'Save Schedule'
      case 'published':
        return 'Update & Publish'
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="w-[95vw] max-w-3xl p-0 gap-0 overflow-hidden max-h-[90vh]"
        onKeyDown={handleKeyDown}
      >
        <DialogTitle className="sr-only">Edit changelog entry</DialogTitle>

        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="text-sm text-muted-foreground">Loading...</div>
          </div>
        ) : (
          <Form {...form}>
            <form onSubmit={handleSubmit} className="flex flex-col max-h-[85vh]">
              <div className="flex-1 overflow-y-auto">
                <ChangelogFormFields
                  form={form}
                  contentJson={contentJson}
                  onContentChange={handleContentChange}
                  linkedPostIds={linkedPostIds}
                  onLinkedPostsChange={setLinkedPostIds}
                  publishState={publishState}
                  onPublishStateChange={setPublishState}
                  error={
                    updateChangelogMutation.isError
                      ? updateChangelogMutation.error.message
                      : undefined
                  }
                />
              </div>

              <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-t bg-muted/30 shrink-0">
                <p className="hidden sm:block text-xs text-muted-foreground">
                  <kbd className="px-1.5 py-0.5 text-[10px] bg-muted rounded border">Cmd</kbd>
                  <span className="mx-1">+</span>
                  <kbd className="px-1.5 py-0.5 text-[10px] bg-muted rounded border">Enter</kbd>
                  <span className="ml-2">to save</span>
                </p>
                <div className="flex items-center gap-2 sm:ml-0 ml-auto">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => onOpenChange(false)}
                    disabled={updateChangelogMutation.isPending}
                  >
                    Cancel
                  </Button>
                  <Button type="submit" size="sm" disabled={updateChangelogMutation.isPending}>
                    {getSubmitButtonText()}
                  </Button>
                </div>
              </div>
            </form>
          </Form>
        )}
      </DialogContent>
    </Dialog>
  )
}
