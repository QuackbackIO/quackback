'use client'

import { useState, useCallback } from 'react'
import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { createChangelogSchema } from '@/lib/shared/schemas/changelog'
import { useCreateChangelog } from '@/lib/client/mutations/changelog'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { PlusIcon } from '@heroicons/react/24/solid'
import { richTextToPlainText } from '@/components/ui/rich-text-editor'
import type { JSONContent } from '@tiptap/react'
import type { Board } from '@/lib/shared/db-types'
import type { PostId } from '@quackback/ids'
import { Form } from '@/components/ui/form'
import { ChangelogFormFields } from './changelog-form-fields'
import { type PublishState } from './publish-controls'

interface CreateChangelogDialogProps {
  boards: Board[]
  onChangelogCreated?: () => void
}

export function CreateChangelogDialog({ boards, onChangelogCreated }: CreateChangelogDialogProps) {
  const [open, setOpen] = useState(false)
  const [contentJson, setContentJson] = useState<JSONContent | null>(null)
  const [linkedPostIds, setLinkedPostIds] = useState<PostId[]>([])
  const [publishState, setPublishState] = useState<PublishState>({ type: 'draft' })
  const createChangelogMutation = useCreateChangelog()

  const form = useForm({
    resolver: standardSchemaResolver(createChangelogSchema),
    defaultValues: {
      title: '',
      content: '',
      boardId: boards[0]?.id || '',
      linkedPostIds: [] as string[],
      publishState: { type: 'draft' as const },
    },
  })

  const handleContentChange = useCallback(
    (json: JSONContent) => {
      setContentJson(json)
      const plainText = richTextToPlainText(json)
      form.setValue('content', plainText, { shouldValidate: true })
    },
    [form]
  )

  const handleSubmit = form.handleSubmit((data) => {
    createChangelogMutation.mutate(
      {
        title: data.title,
        content: data.content,
        boardId: data.boardId,
        contentJson,
        linkedPostIds,
        publishState,
      },
      {
        onSuccess: () => {
          setOpen(false)
          form.reset()
          setContentJson(null)
          setLinkedPostIds([])
          setPublishState({ type: 'draft' })
          onChangelogCreated?.()
        },
      }
    )
  })

  function handleOpenChange(isOpen: boolean) {
    setOpen(isOpen)
    if (!isOpen) {
      form.reset()
      setContentJson(null)
      setLinkedPostIds([])
      setPublishState({ type: 'draft' })
      createChangelogMutation.reset()
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
    if (createChangelogMutation.isPending) {
      return publishState.type === 'published' ? 'Publishing...' : 'Saving...'
    }
    switch (publishState.type) {
      case 'draft':
        return 'Save Draft'
      case 'scheduled':
        return 'Schedule'
      case 'published':
        return 'Publish Now'
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">
          <PlusIcon className="h-4 w-4 mr-1.5" />
          New Entry
        </Button>
      </DialogTrigger>
      <DialogContent
        className="w-[95vw] max-w-3xl p-0 gap-0 overflow-hidden max-h-[90vh]"
        onKeyDown={handleKeyDown}
      >
        <DialogTitle className="sr-only">Create changelog entry</DialogTitle>

        <Form {...form}>
          <form onSubmit={handleSubmit} className="flex flex-col max-h-[85vh]">
            <div className="flex-1 overflow-y-auto">
              <ChangelogFormFields
                form={form}
                boards={boards}
                contentJson={contentJson}
                onContentChange={handleContentChange}
                linkedPostIds={linkedPostIds}
                onLinkedPostsChange={setLinkedPostIds}
                publishState={publishState}
                onPublishStateChange={setPublishState}
                error={
                  createChangelogMutation.isError
                    ? createChangelogMutation.error.message
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
                  onClick={() => setOpen(false)}
                  disabled={createChangelogMutation.isPending}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={createChangelogMutation.isPending}>
                  {getSubmitButtonText()}
                </Button>
              </div>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
