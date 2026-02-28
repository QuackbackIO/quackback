'use client'

import { useState, useCallback, useEffect } from 'react'
import { useKeyboardSubmit } from '@/lib/client/hooks/use-keyboard-submit'
import { ModalFooter } from '@/components/shared/modal-footer'
import { useUrlModal } from '@/lib/client/hooks/use-url-modal'
import { useForm } from 'react-hook-form'
import { useQuery } from '@tanstack/react-query'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { Loader2 } from 'lucide-react'
import { Cog6ToothIcon } from '@heroicons/react/24/solid'
import { ModalHeader } from '@/components/shared/modal-header'
import { UrlModalShell } from '@/components/shared/url-modal-shell'
import { updateChangelogSchema } from '@/lib/shared/schemas/changelog'
import type { TiptapContent } from '@/lib/shared/schemas/posts'
import { useUpdateChangelog } from '@/lib/client/mutations/changelog'
import { changelogQueries } from '@/lib/client/queries/changelog'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'
import { richTextToPlainText } from '@/components/ui/rich-text-editor'
import { ChangelogFormFields } from './changelog-form-fields'
import { ChangelogMetadataSidebar } from './changelog-metadata-sidebar'
import { ChangelogMetadataSidebarContent } from './changelog-metadata-sidebar-content'
import { toPublishState, type PublishState } from '@/lib/shared/schemas/changelog'
import { Route } from '@/routes/admin/changelog'
import { type ChangelogId, type PostId } from '@quackback/ids'
import type { JSONContent } from '@tiptap/react'

interface ChangelogModalProps {
  entryId: string | undefined
}

interface ChangelogModalContentProps {
  entryId: ChangelogId
  onClose: () => void
}

function ChangelogModalContent({ entryId, onClose }: ChangelogModalContentProps) {
  const [contentJson, setContentJson] = useState<JSONContent | null>(null)
  const [linkedPostIds, setLinkedPostIds] = useState<PostId[]>([])
  const [publishState, setPublishState] = useState<PublishState>({ type: 'draft' })
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false)
  const [hasInitialized, setHasInitialized] = useState(false)

  const updateChangelogMutation = useUpdateChangelog()

  // Fetch existing changelog data
  const { data: entry, isLoading } = useQuery({
    ...changelogQueries.detail(entryId),
  })

  const form = useForm({
    resolver: standardSchemaResolver(updateChangelogSchema),
    defaultValues: {
      id: entryId as string,
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
        id: entryId,
        title: data.title,
        content: data.content,
        contentJson: contentJson as TiptapContent | null,
        linkedPostIds,
        publishState,
      },
      {
        onSuccess: () => {
          onClose()
        },
      }
    )
  })

  const handleKeyDown = useKeyboardSubmit(handleSubmit)

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

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <Form {...form}>
      <form onSubmit={handleSubmit} onKeyDown={handleKeyDown} className="flex flex-col h-full">
        {/* Header */}
        <ModalHeader
          section="Changelog"
          title={entry?.title || 'Edit Entry'}
          onClose={onClose}
          viewUrl={entry?.status === 'published' ? `/changelog/${entryId}` : null}
        />

        {/* Main content area - 2 column layout on desktop */}
        <div className="flex flex-1 min-h-0">
          {/* Left: Content editor */}
          <div className="flex-1 overflow-y-auto">
            <ChangelogFormFields
              form={form}
              contentJson={contentJson}
              onContentChange={handleContentChange}
              error={
                updateChangelogMutation.isError ? updateChangelogMutation.error.message : undefined
              }
            />
          </div>

          {/* Right: Metadata sidebar (desktop only) */}
          <ChangelogMetadataSidebar
            publishState={publishState}
            onPublishStateChange={setPublishState}
            linkedPostIds={linkedPostIds}
            onLinkedPostsChange={setLinkedPostIds}
            authorName={entry?.author?.name}
          />
        </div>

        {/* Footer */}
        <ModalFooter
          onCancel={onClose}
          submitLabel={getSubmitButtonText()}
          isPending={updateChangelogMutation.isPending}
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
                  authorName={entry?.author?.name}
                />
              </div>
            </SheetContent>
          </Sheet>
        </ModalFooter>
      </form>
    </Form>
  )
}

export function ChangelogModal({ entryId: urlEntryId }: ChangelogModalProps) {
  const search = Route.useSearch()
  const { open, validatedId, close } = useUrlModal<ChangelogId>({
    urlId: urlEntryId,
    idPrefix: 'changelog',
    searchParam: 'entry',
    route: '/admin/changelog',
    search,
  })

  return (
    <UrlModalShell
      open={open}
      onOpenChange={(o) => !o && close()}
      srTitle="Edit changelog entry"
      hasValidId={!!validatedId}
    >
      {validatedId && <ChangelogModalContent entryId={validatedId} onClose={close} />}
    </UrlModalShell>
  )
}
