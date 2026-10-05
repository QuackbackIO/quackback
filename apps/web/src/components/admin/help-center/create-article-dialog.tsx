import { useState, useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useKeyboardSubmit } from '@/lib/client/hooks/use-keyboard-submit'
import { ModalFooter } from '@/components/shared/modal-footer'
import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { createArticleSchema } from '@/lib/shared/schemas/help-center'
import type { TiptapContent } from '@/lib/shared/schemas/posts'
import { useCreateArticle, usePublishArticle } from '@/lib/client/mutations/help-center'
import { useHasPermission } from '@/lib/client/use-permissions'
import { PERMISSIONS } from '@/lib/shared/permissions'
import type { KbArticleId } from '@quackback/ids'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { NewButton } from '@/components/shared/new-button'
import { Cog6ToothIcon } from '@heroicons/react/24/solid'
import { Form } from '@/components/ui/form'
import { HelpCenterFormFields } from './help-center-form-fields'
import {
  HelpCenterMetadataSidebar,
  HelpCenterMetadataSidebarContent,
} from './help-center-metadata-sidebar'
import type { JSONContent } from '@tiptap/react'
import type { EditorDocument } from '@/components/ui/rich-text-editor'

interface CreateArticleDialogProps {
  /** Controlled open state. When provided, the built-in trigger button is hidden. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

export function CreateArticleDialog({
  open: openProp,
  onOpenChange,
}: CreateArticleDialogProps = {}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = openProp !== undefined
  const open = isControlled ? openProp : internalOpen
  const [contentJson, setContentJson] = useState<JSONContent | null>(null)
  const [categoryId, setCategoryId] = useState('')
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false)
  const createArticleMutation = useCreateArticle()
  const publishArticleMutation = usePublishArticle()
  // Publishing takes the same permission as writing; checked so the button
  // never offers what the server would refuse.
  const canPublish = useHasPermission(PERMISSIONS.HELP_CENTER_MANAGE)
  const [saveError, setSaveError] = useState<string | null>(null)
  const isPending = createArticleMutation.isPending || publishArticleMutation.isPending
  const navigate = useNavigate()

  const form = useForm({
    resolver: standardSchemaResolver(createArticleSchema),
    defaultValues: {
      categoryId: '',
      title: '',
      content: '',
    },
  })

  const handleContentChange = useCallback(
    (document: EditorDocument) => {
      setContentJson(document.json())
      form.setValue('content', document.markdown(), { shouldValidate: false, shouldDirty: true })
    },
    [form]
  )

  const handleCategoryChange = useCallback(
    (id: string) => {
      setCategoryId(id)
      form.setValue('categoryId', id, { shouldValidate: true })
    },
    [form]
  )

  // A draft that saved but did not publish: a retry publishes it, never a second copy.
  const [savedDraftId, setSavedDraftId] = useState<string | null>(null)

  const save = (publish: boolean) =>
    form.handleSubmit(async (data) => {
      setSaveError(null)
      let articleId = savedDraftId
      try {
        if (!articleId) {
          const newArticle = await createArticleMutation.mutateAsync({
            categoryId: data.categoryId,
            title: data.title,
            content: data.content,
            contentJson: contentJson as TiptapContent | null,
          })
          articleId = newArticle.id
        }
        if (publish) await publishArticleMutation.mutateAsync(articleId as KbArticleId)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (articleId) setSavedDraftId(articleId)
        // Stay open, so whoever clicked Publish sees it is not live yet.
        setSaveError(articleId ? `Saved as a draft, but not published: ${message}` : message)
        return
      }
      handleOpenChange(false)
      void navigate({ to: '/admin/help-center', search: { article: articleId } })
    })
  const handleSubmit = save(false)
  const handlePublish = save(true)

  function handleOpenChange(isOpen: boolean) {
    if (isControlled) {
      onOpenChange?.(isOpen)
    } else {
      setInternalOpen(isOpen)
    }
    if (!isOpen) {
      form.reset()
      setContentJson(null)
      setCategoryId('')
      createArticleMutation.reset()
      publishArticleMutation.reset()
      setSaveError(null)
      setSavedDraftId(null)
    }
  }

  const handleKeyDown = useKeyboardSubmit(handleSubmit)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      {!isControlled && (
        <DialogTrigger asChild>
          <NewButton noun="article" />
        </DialogTrigger>
      )}
      <DialogContent
        className="w-[95vw] sm:w-[90vw] lg:max-w-5xl xl:max-w-6xl h-[85vh] p-0 gap-0 overflow-hidden flex flex-col"
        onKeyDown={handleKeyDown}
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Create help article</DialogTitle>

        <Form {...form}>
          <form onSubmit={handleSubmit} className="flex flex-col h-full">
            <div className="flex flex-1 min-h-0">
              <div className="flex-1 overflow-y-auto">
                <HelpCenterFormFields
                  form={form}
                  contentJson={contentJson}
                  onContentChange={handleContentChange}
                  error={saveError ?? undefined}
                />
              </div>

              <HelpCenterMetadataSidebar
                categoryId={categoryId}
                onCategoryChange={handleCategoryChange}
                isPublished={false}
                onPublishToggle={() => {}}
              />
            </div>

            <ModalFooter
              onCancel={() => handleOpenChange(false)}
              submitLabel={isPending ? 'Saving...' : canPublish ? 'Publish' : 'Save draft'}
              isPending={isPending}
              {...(canPublish ? { submitType: 'button' as const, onSubmit: handlePublish } : {})}
            >
              {canPublish && (
                <Button type="submit" variant="outline" size="sm" disabled={isPending}>
                  Save draft
                </Button>
              )}
              <Sheet open={mobileSettingsOpen} onOpenChange={setMobileSettingsOpen}>
                <SheetTrigger asChild>
                  <Button type="button" variant="outline" size="sm" className="lg:hidden">
                    <Cog6ToothIcon className="h-4 w-4 mr-1.5" />
                    Settings
                  </Button>
                </SheetTrigger>
                <SheetContent side="bottom" className="h-[70vh]">
                  <SheetHeader>
                    <SheetTitle>Article settings</SheetTitle>
                  </SheetHeader>
                  <div className="py-4 overflow-y-auto">
                    <HelpCenterMetadataSidebarContent
                      categoryId={categoryId}
                      onCategoryChange={handleCategoryChange}
                      isPublished={false}
                      onPublishToggle={() => {}}
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
