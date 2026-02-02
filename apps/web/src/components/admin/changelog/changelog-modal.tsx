'use client'

import { useState, useCallback, useEffect, startTransition } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { useQuery } from '@tanstack/react-query'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { Loader2 } from 'lucide-react'
import {
  XMarkIcon,
  Cog6ToothIcon,
  ArrowTopRightOnSquareIcon,
  LinkIcon,
} from '@heroicons/react/24/solid'
import { toast } from 'sonner'
import { updateChangelogSchema } from '@/lib/shared/schemas/changelog'
import { useUpdateChangelog } from '@/lib/client/mutations/changelog'
import { changelogQueries } from '@/lib/client/queries/changelog'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'
import { richTextToPlainText } from '@/components/ui/rich-text-editor'
import { ChangelogFormFields } from './changelog-form-fields'
import { ChangelogMetadataSidebar } from './changelog-metadata-sidebar'
import { ChangelogMetadataSidebarContent } from './changelog-metadata-sidebar-content'
import { type PublishState } from './publish-controls'
import { Route } from '@/routes/admin/changelog'
import { ensureTypeId, type ChangelogId, type PostId } from '@quackback/ids'
import type { JSONContent } from '@tiptap/react'

interface ChangelogModalProps {
  entryId: string | undefined
}

interface ChangelogModalContentProps {
  entryId: ChangelogId
  onClose: () => void
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
        contentJson,
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

  async function handleCopyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(window.location.href)
      toast.success('Link copied to clipboard')
    } catch {
      toast.error('Failed to copy link')
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
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
        <header className="sticky top-0 z-20 bg-gradient-to-b from-card/98 to-card/95 backdrop-blur-md border-b border-border/40 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
          <div className="flex items-center justify-between px-6 py-2.5">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="h-8 w-8 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-all duration-150"
              >
                <XMarkIcon className="h-4 w-4" />
              </Button>

              <div className="hidden sm:flex items-center gap-2 text-sm">
                <span className="text-muted-foreground/60">Changelog</span>
                <span className="text-muted-foreground/40">/</span>
                <span className="text-foreground/80 font-medium truncate max-w-[240px]">
                  {entry?.title || 'Edit Entry'}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              {entry?.status === 'published' && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => window.open(`/changelog/${entryId}`, '_blank')}
                  className="gap-1.5 h-8"
                >
                  <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">View</span>
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleCopyLink}
                className="gap-1.5 h-8"
              >
                <LinkIcon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Copy Link</span>
              </Button>
            </div>
          </div>
        </header>

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
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-t bg-muted/30 shrink-0">
          <p className="hidden sm:block text-xs text-muted-foreground">
            <kbd className="px-1.5 py-0.5 text-[10px] bg-muted rounded border">Cmd</kbd>
            <span className="mx-1">+</span>
            <kbd className="px-1.5 py-0.5 text-[10px] bg-muted rounded border">Enter</kbd>
            <span className="ml-2">to save</span>
          </p>
          <div className="flex items-center gap-2 sm:ml-0 ml-auto">
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

            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
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
  )
}

export function ChangelogModal({ entryId: urlEntryId }: ChangelogModalProps) {
  const navigate = useNavigate({ from: Route.fullPath })
  const search = Route.useSearch()

  // Local state for instant UI - syncs with URL
  const [localEntryId, setLocalEntryId] = useState<string | undefined>(urlEntryId)
  const isOpen = !!localEntryId

  // Sync local state when URL changes (e.g., browser back/forward)
  useEffect(() => {
    setLocalEntryId(urlEntryId)
  }, [urlEntryId])

  // Validate and convert entryId
  let validatedEntryId: ChangelogId | null = null
  if (localEntryId) {
    try {
      validatedEntryId = ensureTypeId(localEntryId, 'changelog')
    } catch {
      // Invalid entry ID format
    }
  }

  // Close modal instantly, then update URL in background
  const close = useCallback(() => {
    setLocalEntryId(undefined) // Instant UI update
    startTransition(() => {
      const { entry: _, ...restSearch } = search
      navigate({
        to: '/admin/changelog',
        search: restSearch,
        replace: true,
      })
    })
  }, [navigate, search])

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent
        className="w-[95vw] sm:w-[90vw] lg:max-w-5xl xl:max-w-6xl h-[85vh] p-0 gap-0 overflow-hidden flex flex-col"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Edit changelog entry</DialogTitle>
        {validatedEntryId && <ChangelogModalContent entryId={validatedEntryId} onClose={close} />}
      </DialogContent>
    </Dialog>
  )
}
