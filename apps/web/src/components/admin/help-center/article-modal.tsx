import { useState, useCallback, useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { useQuery } from '@tanstack/react-query'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { Loader2 } from 'lucide-react'
import { Cog6ToothIcon } from '@heroicons/react/24/solid'
import { useRouterState } from '@tanstack/react-router'
import { useKeyboardSubmit } from '@/lib/client/hooks/use-keyboard-submit'
import { useUrlModal } from '@/lib/client/hooks/use-url-modal'
import { ModalHeader } from '@/components/shared/modal-header'
import { ModalFooter } from '@/components/shared/modal-footer'
import { UrlModalShell } from '@/components/shared/url-modal-shell'
import { Form } from '@/components/ui/form'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { HelpCenterFormFields } from './help-center-form-fields'
import {
  HelpCenterMetadataSidebar,
  HelpCenterMetadataSidebarContent,
} from './help-center-metadata-sidebar'
import { ArticleTranslationsDialog } from './article-translations-dialog'
import { ArticleFeedbackReasonsDialog } from './article-feedback-reasons-dialog'
import { updateArticleSchema } from '@/lib/shared/schemas/help-center'
import type { TiptapContent } from '@/lib/shared/schemas/posts'
import {
  useUpdateArticle,
  usePublishArticle,
  useUnpublishArticle,
} from '@/lib/client/mutations/help-center'
import { helpCenterQueries } from '@/lib/client/queries/help-center'
import { listSegmentsFn } from '@/lib/server/functions/admin'
import { getInitialContentJson } from '@/components/admin/feedback/detail/post-utils'
import type { ArticleId } from '@quackback/ids'
import type { JSONContent } from '@tiptap/react'

interface ArticleModalProps {
  articleId: string | undefined
}

interface ArticleModalContentProps {
  articleId: ArticleId
  onClose: () => void
}

function ArticleModalContent({ articleId, onClose }: ArticleModalContentProps) {
  const [contentJson, setContentJson] = useState<JSONContent | null>(null)
  const [translationsOpen, setTranslationsOpen] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false)
  const hasInitialized = useRef(false)

  const updateArticleMutation = useUpdateArticle()
  const publishArticleMutation = usePublishArticle()
  const unpublishArticleMutation = useUnpublishArticle()

  const { data: article, isLoading } = useQuery({
    ...helpCenterQueries.articleDetail(articleId),
  })
  const segmentsQuery = useQuery({
    queryKey: ['admin', 'segments'] as const,
    queryFn: () => listSegmentsFn(),
    staleTime: 60_000,
  })
  const segments = (segmentsQuery.data ?? []).map((s) => ({ id: s.id, name: s.name }))

  const form = useForm({
    resolver: standardSchemaResolver(updateArticleSchema),
    defaultValues: {
      id: articleId as string,
      title: '',
      description: '',
      content: '',
      categoryId: '',
      segmentIds: [] as string[],
    },
  })

  const { isDirty } = form.formState
  const categoryId = form.watch('categoryId')
  const segmentIds = form.watch('segmentIds') ?? []

  useEffect(() => {
    if (article && !hasInitialized.current) {
      hasInitialized.current = true
      form.reset({
        id: articleId as string,
        title: article.title,
        description: article.description ?? '',
        content: article.content,
        categoryId: article.categoryId,
        segmentIds: article.segmentIds ?? [],
      })
      setContentJson(getInitialContentJson(article))
    }
  }, [article, articleId, form])

  const handleContentChange = useCallback(
    (json: JSONContent, _html: string, markdown: string) => {
      setContentJson(json)
      form.setValue('content', markdown, { shouldValidate: false, shouldDirty: true })
    },
    [form]
  )

  const handleCategoryChange = useCallback(
    (id: string) => {
      form.setValue('categoryId', id, { shouldDirty: true })
    },
    [form]
  )

  const handleSegmentsChange = useCallback(
    (ids: string[]) => {
      form.setValue('segmentIds', ids, { shouldDirty: true })
    },
    [form]
  )

  const isPublished = !!article?.publishedAt
  const publishPending = publishArticleMutation.isPending || unpublishArticleMutation.isPending

  const handlePublishToggle = useCallback(() => {
    if (isPublished) unpublishArticleMutation.mutate(articleId)
    else publishArticleMutation.mutate(articleId)
  }, [articleId, isPublished, publishArticleMutation, unpublishArticleMutation])

  const handleSubmit = form.handleSubmit((data) => {
    updateArticleMutation.mutate(
      {
        id: articleId,
        title: data.title,
        description: data.description?.trim() || undefined,
        content: data.content,
        contentJson: contentJson as TiptapContent | null,
        categoryId: data.categoryId,
        segmentIds: data.segmentIds ?? [],
      },
      {
        onSuccess: () => {
          onClose()
        },
      }
    )
  })

  const handleKeyDown = useKeyboardSubmit(handleSubmit)

  if (isLoading || !article || !hasInitialized.current) {
    return (
      <div className="flex h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const publicArticleUrl =
    isPublished && article.category?.slug && article.slug
      ? `/hc/articles/${article.category.slug}/${article.slug}`
      : null

  const sidebar = {
    categoryId,
    onCategoryChange: handleCategoryChange,
    isPublished,
    onPublishToggle: handlePublishToggle,
    authorName: article.author?.name,
    segments,
    segmentIds,
    onSegmentIdsChange: handleSegmentsChange,
    notHelpfulCount: article.notHelpfulCount,
    onOpenFeedback: () => setFeedbackOpen(true),
    onOpenTranslations: () => setTranslationsOpen(true),
    publishPending,
  }

  return (
    <Form {...form}>
      <form onSubmit={handleSubmit} onKeyDown={handleKeyDown} className="flex h-full flex-col">
        <ModalHeader
          section="Help Center"
          title={article.title}
          onClose={onClose}
          viewUrl={publicArticleUrl}
        />

        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            <HelpCenterFormFields
              form={form}
              contentJson={contentJson}
              onContentChange={handleContentChange}
              showDescription
              error={
                updateArticleMutation.isError ? updateArticleMutation.error.message : undefined
              }
            />
          </div>
          <HelpCenterMetadataSidebar {...sidebar} />
        </div>

        <ModalFooter
          onCancel={onClose}
          submitLabel={updateArticleMutation.isPending ? 'Saving...' : 'Save Changes'}
          isPending={updateArticleMutation.isPending}
          submitDisabled={!isDirty}
        >
          <Sheet open={mobileSettingsOpen} onOpenChange={setMobileSettingsOpen}>
            <SheetTrigger asChild>
              <Button type="button" variant="outline" size="sm" className="lg:hidden">
                <Cog6ToothIcon className="mr-1.5 h-4 w-4" />
                Settings
              </Button>
            </SheetTrigger>
            <SheetContent side="bottom" className="h-[70vh]">
              <SheetHeader>
                <SheetTitle>Article Settings</SheetTitle>
              </SheetHeader>
              <div className="overflow-y-auto py-4">
                <HelpCenterMetadataSidebarContent {...sidebar} />
              </div>
            </SheetContent>
          </Sheet>
        </ModalFooter>
      </form>
      <ArticleTranslationsDialog
        articleId={articleId}
        open={translationsOpen}
        onOpenChange={setTranslationsOpen}
      />
      <ArticleFeedbackReasonsDialog
        articleId={articleId}
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
      />
    </Form>
  )
}

export function ArticleModal({ articleId: urlArticleId }: ArticleModalProps) {
  const { pathname, search } = useRouterState({ select: (s) => s.location })
  const { open, validatedId, close } = useUrlModal<ArticleId>({
    urlId: urlArticleId,
    idPrefix: 'article',
    searchParam: 'article',
    route: pathname,
    search: search as Record<string, unknown>,
  })

  return (
    <UrlModalShell
      open={open}
      onOpenChange={(o) => !o && close()}
      srTitle="Edit article"
      hasValidId={!!validatedId}
    >
      {validatedId && <ArticleModalContent articleId={validatedId} onClose={close} />}
    </UrlModalShell>
  )
}
