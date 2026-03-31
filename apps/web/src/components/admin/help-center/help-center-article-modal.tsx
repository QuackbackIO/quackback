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
import { updateArticleSchema } from '@/lib/shared/schemas/help-center'
import type { TiptapContent } from '@/lib/shared/schemas/posts'
import {
  useUpdateArticle,
  usePublishArticle,
  useUnpublishArticle,
} from '@/lib/client/mutations/help-center'
import { helpCenterQueries } from '@/lib/client/queries/help-center'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'
import { HelpCenterFormFields } from './help-center-form-fields'
import {
  HelpCenterMetadataSidebar,
  HelpCenterMetadataSidebarContent,
} from './help-center-metadata-sidebar'
import { Route } from '@/routes/admin/help-center'
import type { HelpCenterArticleId } from '@quackback/ids'
import type { JSONContent } from '@tiptap/react'

interface ArticleModalProps {
  articleId: string | undefined
}

interface ArticleModalContentProps {
  articleId: HelpCenterArticleId
  onClose: () => void
}

function ArticleModalContent({ articleId, onClose }: ArticleModalContentProps) {
  const [contentJson, setContentJson] = useState<JSONContent | null>(null)
  const [categoryId, setCategoryId] = useState('')
  const [isPublished, setIsPublished] = useState(false)
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false)
  const [hasInitialized, setHasInitialized] = useState(false)

  const updateArticleMutation = useUpdateArticle()
  const publishArticleMutation = usePublishArticle()
  const unpublishArticleMutation = useUnpublishArticle()

  const { data: article, isLoading } = useQuery({
    ...helpCenterQueries.articleDetail(articleId),
  })

  const form = useForm({
    resolver: standardSchemaResolver(updateArticleSchema),
    defaultValues: {
      id: articleId as string,
      title: '',
      content: '',
    },
  })

  useEffect(() => {
    if (article && !hasInitialized) {
      form.setValue('title', article.title)
      form.setValue('content', article.content)
      setContentJson(article.contentJson as JSONContent | null)
      setCategoryId(article.categoryId)
      setIsPublished(!!article.publishedAt)
      setHasInitialized(true)
    }
  }, [article, form, hasInitialized])

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
      form.setValue('categoryId', id)
    },
    [form]
  )

  const handlePublishToggle = useCallback(() => {
    if (isPublished) {
      unpublishArticleMutation.mutate(articleId, {
        onSuccess: () => setIsPublished(false),
      })
    } else {
      publishArticleMutation.mutate(articleId, {
        onSuccess: () => setIsPublished(true),
      })
    }
  }, [isPublished, articleId, publishArticleMutation, unpublishArticleMutation])

  const handleSubmit = form.handleSubmit((data) => {
    updateArticleMutation.mutate(
      {
        id: articleId,
        title: data.title,
        content: data.content,
        contentJson: contentJson as TiptapContent | null,
        categoryId,
      },
      {
        onSuccess: () => {
          onClose()
        },
      }
    )
  })

  const handleKeyDown = useKeyboardSubmit(handleSubmit)

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
        <ModalHeader
          section="Help Center"
          title={article?.title || 'Edit Article'}
          onClose={onClose}
          viewUrl={isPublished && article ? `/help/${article.category.slug}/${article.slug}` : null}
        />

        <div className="flex flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto">
            <HelpCenterFormFields
              form={form}
              contentJson={contentJson}
              onContentChange={handleContentChange}
              error={
                updateArticleMutation.isError ? updateArticleMutation.error.message : undefined
              }
            />
          </div>

          <HelpCenterMetadataSidebar
            categoryId={categoryId}
            onCategoryChange={handleCategoryChange}
            isPublished={isPublished}
            onPublishToggle={handlePublishToggle}
            authorName={article?.author?.name}
          />
        </div>

        <ModalFooter
          onCancel={onClose}
          submitLabel={updateArticleMutation.isPending ? 'Saving...' : 'Save Changes'}
          isPending={updateArticleMutation.isPending}
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
                  isPublished={isPublished}
                  onPublishToggle={handlePublishToggle}
                  authorName={article?.author?.name}
                />
              </div>
            </SheetContent>
          </Sheet>
        </ModalFooter>
      </form>
    </Form>
  )
}

export function HelpCenterArticleModal({ articleId: urlArticleId }: ArticleModalProps) {
  const search = Route.useSearch()
  const { open, validatedId, close } = useUrlModal<HelpCenterArticleId>({
    urlId: urlArticleId,
    idPrefix: 'helpcenter_article',
    searchParam: 'article',
    route: '/admin/help-center',
    search,
  })

  return (
    <UrlModalShell
      open={open}
      onOpenChange={(o) => !o && close()}
      srTitle="Edit help article"
      hasValidId={!!validatedId}
    >
      {validatedId && <ArticleModalContent articleId={validatedId} onClose={close} />}
    </UrlModalShell>
  )
}
