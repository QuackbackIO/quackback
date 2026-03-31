import { useState, useCallback } from 'react'
import { useKeyboardSubmit } from '@/lib/client/hooks/use-keyboard-submit'
import { ModalFooter } from '@/components/shared/modal-footer'
import { useForm } from 'react-hook-form'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { createArticleSchema } from '@/lib/shared/schemas/help-center'
import type { TiptapContent } from '@/lib/shared/schemas/posts'
import { useCreateArticle } from '@/lib/client/mutations/help-center'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { PlusIcon, Cog6ToothIcon } from '@heroicons/react/24/solid'
import { Form } from '@/components/ui/form'
import { HelpCenterFormFields } from './help-center-form-fields'
import {
  HelpCenterMetadataSidebar,
  HelpCenterMetadataSidebarContent,
} from './help-center-metadata-sidebar'
import type { JSONContent } from '@tiptap/react'

export function CreateArticleDialog() {
  const [open, setOpen] = useState(false)
  const [contentJson, setContentJson] = useState<JSONContent | null>(null)
  const [categoryId, setCategoryId] = useState('')
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false)
  const createArticleMutation = useCreateArticle()

  const form = useForm({
    resolver: standardSchemaResolver(createArticleSchema),
    defaultValues: {
      categoryId: '',
      title: '',
      content: '',
    },
  })

  const handleContentChange = useCallback(
    (json: JSONContent, _html: string, markdown: string) => {
      setContentJson(json)
      form.setValue('content', markdown, { shouldValidate: true })
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

  const handleSubmit = form.handleSubmit((data) => {
    createArticleMutation.mutate(
      {
        categoryId: data.categoryId,
        title: data.title,
        content: data.content,
        contentJson: contentJson as TiptapContent | null,
      },
      {
        onSuccess: () => {
          setOpen(false)
          form.reset()
          setContentJson(null)
          setCategoryId('')
        },
      }
    )
  })

  function handleOpenChange(isOpen: boolean) {
    setOpen(isOpen)
    if (!isOpen) {
      form.reset()
      setContentJson(null)
      setCategoryId('')
      createArticleMutation.reset()
    }
  }

  const handleKeyDown = useKeyboardSubmit(handleSubmit)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button size="sm">
          <PlusIcon className="h-4 w-4 mr-1.5" />
          New Article
        </Button>
      </DialogTrigger>
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
                  error={
                    createArticleMutation.isError ? createArticleMutation.error.message : undefined
                  }
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
              onCancel={() => setOpen(false)}
              submitLabel={createArticleMutation.isPending ? 'Saving...' : 'Save Draft'}
              isPending={createArticleMutation.isPending}
            >
              <Sheet open={mobileSettingsOpen} onOpenChange={setMobileSettingsOpen}>
                <SheetTrigger asChild>
                  <Button type="button" variant="outline" size="sm" className="lg:hidden">
                    <Cog6ToothIcon className="h-4 w-4 mr-1.5" />
                    Settings
                  </Button>
                </SheetTrigger>
                <SheetContent side="bottom" className="h-[70vh]">
                  <SheetHeader>
                    <SheetTitle>Article Settings</SheetTitle>
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
