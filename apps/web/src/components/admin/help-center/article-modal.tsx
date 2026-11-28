import { useState, useCallback, useEffect, useRef } from 'react'
import { useForm } from 'react-hook-form'
import { useQuery } from '@tanstack/react-query'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { Loader2 } from 'lucide-react'
import { Cog6ToothIcon } from '@heroicons/react/24/solid'
import { useKeyboardSubmit } from '@/lib/client/hooks/use-keyboard-submit'
import { ModalHeader } from '@/components/shared/modal-header'
import { ModalFooter } from '@/components/shared/modal-footer'
import { Form } from '@/components/ui/form'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { HelpCenterFormFields } from './help-center-form-fields'
import {
  HelpCenterMetadataSidebar,
  HelpCenterMetadataSidebarContent,
} from './help-center-metadata-sidebar'
import { ArticleLanguageBar } from './article-language-bar'
import { ArticleTranslationPane, articleLanguagesKey } from './article-translation-pane'
import { languageDotState } from './article-languages'
import { getArticleLanguagesFn } from '@/lib/server/functions/help-center-article-languages'
import { cn } from '@/lib/shared/utils'
import { ArticleFeedbackReasonsDialog } from './article-feedback-reasons-dialog'
import { updateArticleSchema } from '@/lib/shared/schemas/help-center'
import { isNotFoundError } from '@/lib/shared/errors'
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
import type { EditorDocument } from '@/components/ui/rich-text-editor'

interface ArticleModalContentProps {
  articleId: ArticleId
  onClose: () => void
}

export function ArticleModalContent({ articleId, onClose }: ArticleModalContentProps) {
  const [contentJson, setContentJson] = useState<JSONContent | null>(null)
  const [activeLocale, setActiveLocale] = useState<string | null>(null)
  const [visited, setVisited] = useState<string[]>([])
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [mobileSettingsOpen, setMobileSettingsOpen] = useState(false)
  const hasInitialized = useRef(false)

  const updateArticleMutation = useUpdateArticle()
  const publishArticleMutation = usePublishArticle()
  const unpublishArticleMutation = useUnpublishArticle()

  const {
    data: article,
    isLoading,
    error,
  } = useQuery({
    ...helpCenterQueries.articleDetail(articleId),
    // An article that is not there will not appear on a retry.
    retry: (failureCount, err) => !isNotFoundError(err) && failureCount < 3,
  })
  const segmentsQuery = useQuery({
    queryKey: ['admin', 'segments'] as const,
    queryFn: () => listSegmentsFn(),
    staleTime: 60_000,
  })
  const segments = (segmentsQuery.data ?? []).map((s) => ({ id: s.id, name: s.name }))
  const languagesQuery = useQuery({
    queryKey: articleLanguagesKey(articleId),
    queryFn: () => getArticleLanguagesFn({ data: { articleId } }),
  })
  const languages = languagesQuery.data
  const selectLanguage = useCallback((locale: string) => {
    setActiveLocale(locale)
    setVisited((v) => (v.includes(locale) ? v : [...v, locale]))
  }, [])

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
    (document: EditorDocument) => {
      setContentJson(document.json())
      form.setValue('content', document.markdown(), { shouldValidate: false, shouldDirty: true })
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
        // '' clears the description; undefined would leave it unchanged.
        description: data.description?.trim() ?? '',
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
  // Keys typed in a portaled child dialog (New category) bubble here through the
  // React tree; only the article's own DOM may trigger the save shortcut.
  const handleOwnKeyDown = (e: React.KeyboardEvent) => {
    if (e.currentTarget.contains(e.target as Node)) handleKeyDown(e)
  }

  if (error && !article) {
    return (
      <div className="flex h-[400px] flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm text-muted-foreground">
          {isNotFoundError(error)
            ? 'This article no longer exists.'
            : 'This article could not be loaded.'}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    )
  }

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
    languagesSummary: languages ? summarizeLanguages(languages.languages) : undefined,
    publishPending,
  }

  const ownLocale = languages?.ownLocale ?? article.locale
  const active = activeLocale ?? ownLocale
  const header = (
    <>
      <ModalHeader
        section="Help center"
        title={article.title}
        onClose={onClose}
        viewUrl={publicArticleUrl}
      />
      {languages && languages.languages.length > 0 ? (
        <ArticleLanguageBar
          ownLocale={ownLocale}
          isMain={ownLocale === languages.mainLocale}
          entries={languages.languages.map((l) => ({
            locale: l.locale,
            state: languageDotState(l),
          }))}
          active={active}
          onSelect={selectLanguage}
        />
      ) : null}
    </>
  )
  const audience =
    segmentIds.length === 0
      ? 'Everyone'
      : segments
          .filter((s) => segmentIds.includes(s.id))
          .map((s) => s.name)
          .join(', ') || 'Some people'

  return (
    <div className="flex h-full flex-col">
      <div className={cn('flex min-h-0 flex-1 flex-col', active !== ownLocale && 'hidden')}>
        <Form {...form}>
          <form
            onSubmit={handleSubmit}
            onKeyDown={handleOwnKeyDown}
            className="flex h-full flex-col"
          >
            {header}

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
              submitLabel={updateArticleMutation.isPending ? 'Saving…' : 'Save changes'}
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
                    <SheetTitle>Article settings</SheetTitle>
                  </SheetHeader>
                  <div className="overflow-y-auto py-4">
                    <HelpCenterMetadataSidebarContent {...sidebar} />
                  </div>
                </SheetContent>
              </Sheet>
            </ModalFooter>
          </form>
        </Form>
      </div>
      {languages
        ? visited
            .filter((l) => l !== ownLocale)
            .map((locale) => {
              const entry = languages.languages.find((l) => l.locale === locale)
              if (!entry) return null
              return (
                <div
                  key={locale}
                  className={cn('flex min-h-0 flex-1 flex-col', active !== locale && 'hidden')}
                >
                  <ArticleTranslationPane
                    articleId={articleId}
                    ownLocale={ownLocale}
                    entry={entry}
                    aiAvailable={languages.aiAvailable}
                    source={{
                      title: article.title,
                      description: article.description ?? null,
                      content: article.content,
                      contentJson: getInitialContentJson(article),
                    }}
                    shared={{
                      categoryName: article.category?.name,
                      authorName: article.author?.name,
                      audience,
                    }}
                    header={header}
                    onClose={onClose}
                  />
                </div>
              )
            })
        : null}
      <ArticleFeedbackReasonsDialog
        articleId={articleId}
        open={feedbackOpen}
        onOpenChange={setFeedbackOpen}
      />
    </div>
  )
}

/** "1 published · 1 needs update" for the sidebar's Languages row. */
function summarizeLanguages(
  entries: Array<Parameters<typeof languageDotState>[0]>
): string | undefined {
  if (entries.length === 0) return undefined
  const counts = { published: 0, needs_update: 0, draft: 0, missing: 0 }
  for (const e of entries) counts[languageDotState(e)]++
  const parts = [
    counts.published ? `${counts.published} published` : null,
    counts.needs_update ? `${counts.needs_update} needs update` : null,
    counts.draft ? `${counts.draft} draft` : null,
    counts.missing ? `${counts.missing} not translated` : null,
  ].filter(Boolean)
  return parts.join(' · ')
}
