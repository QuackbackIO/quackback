'use client'

import { useState, useCallback } from 'react'
import { useKeyboardSubmit } from '@/lib/client/hooks/use-keyboard-submit'
import { ModalFooter } from '@/components/shared/modal-footer'
import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { createChangelogSchema } from '@/lib/shared/schemas/changelog'
import { useCreateChangelog } from '@/lib/client/mutations/changelog'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { PlusIcon, Cog6ToothIcon } from '@heroicons/react/24/solid'
import { richTextToPlainText } from '@/components/ui/rich-text-editor'
import { Form } from '@/components/ui/form'
import { ChangelogFormFields } from './changelog-form-fields'
import { ChangelogMetadataSidebar } from './changelog-metadata-sidebar'
import { type PublishState } from './publish-controls'
import type { JSONContent } from '@tiptap/react'
import type { PostId } from '@quackback/ids'

// Mobile-only version of the sidebar content for the sheet
import { ChangelogMetadataSidebarContent } from './changelog-metadata-sidebar-content'

interface CreateChangelogDialogProps {
  onChangelogCreated?: () => void
}

export function CreateChangelogDialog({ onChangelogCreated }: CreateChangelogDialogProps) {
  const [open, setOpen] = useState(false)
  const [contentJson, setContentJson] = useState<JSONContent | null>(null)
  const [linkedPostIds, setLinkedPostIds] = useState<PostId[]>([])
  const [publishState, setPublishState] = useState<PublishState>({ type: 'draft' })
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false)
  const createChangelogMutation = useCreateChangelog()

  const form = useForm({
    resolver: standardSchemaResolver(createChangelogSchema),
    defaultValues: {
      title: '',
      content: '',
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

  const handleKeyDown = useKeyboardSubmit(handleSubmit)

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
        className="w-[95vw] sm:w-[90vw] lg:max-w-5xl xl:max-w-6xl h-[85vh] p-0 gap-0 overflow-hidden flex flex-col"
        onKeyDown={handleKeyDown}
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Create changelog entry</DialogTitle>

        <Form {...form}>
          <form onSubmit={handleSubmit} className="flex flex-col h-full">
            {/* Main content area - 2 column layout on desktop */}
            <div className="flex flex-1 min-h-0">
              {/* Left: Content editor */}
              <div className="flex-1 overflow-y-auto">
                <ChangelogFormFields
                  form={form}
                  contentJson={contentJson}
                  onContentChange={handleContentChange}
                  error={
                    createChangelogMutation.isError
                      ? createChangelogMutation.error.message
                      : undefined
                  }
                />
              </div>

              {/* Right: Metadata sidebar (desktop only) */}
              <ChangelogMetadataSidebar
                publishState={publishState}
                onPublishStateChange={setPublishState}
                linkedPostIds={linkedPostIds}
                onLinkedPostsChange={setLinkedPostIds}
              />
            </div>

            {/* Footer */}
            <ModalFooter
              onCancel={() => setOpen(false)}
              submitLabel={getSubmitButtonText()}
              isPending={createChangelogMutation.isPending}
            >
              {/* Mobile settings button */}
              <Sheet open={mobileSettingsOpen} onOpenChange={setMobileSettingsOpen}>
                <SheetTrigger asChild>
                  <Button type="button" variant="outline" size="sm" className="lg:hidden">
                    <Cog6ToothIcon className="h-4 w-4 mr-1.5" />
                    Settings
                  </Button>
                </SheetTrigger>
                <SheetContent side="bottom" className="h-[70vh]">
                  <SheetHeader>
                    <SheetTitle>Entry Settings</SheetTitle>
                  </SheetHeader>
                  <div className="py-4 overflow-y-auto">
                    <ChangelogMetadataSidebarContent
                      publishState={publishState}
                      onPublishStateChange={setPublishState}
                      linkedPostIds={linkedPostIds}
                      onLinkedPostsChange={setLinkedPostIds}
                    />
                  </div>
                </SheetContent>
              </Sheet>
            </ModalFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}
