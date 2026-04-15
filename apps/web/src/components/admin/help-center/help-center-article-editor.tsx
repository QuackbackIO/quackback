import { useState, useCallback, useEffect } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { useQuery } from '@tanstack/react-query'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { Loader2 } from 'lucide-react'
import { ArrowLeftIcon, Cog6ToothIcon } from '@heroicons/react/24/solid'
import { Button } from '@/components/ui/button'
import { Form } from '@/components/ui/form'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useKeyboardSubmit } from '@/lib/client/hooks/use-keyboard-submit'
import { updateArticleSchema } from '@/lib/shared/schemas/help-center'
import type { TiptapContent } from '@/lib/shared/schemas/posts'
import {
  useUpdateArticle,
  usePublishArticle,
  useUnpublishArticle,
} from '@/lib/client/mutations/help-center'
import { helpCenterQueries } from '@/lib/client/queries/help-center'
import { getInitialContentJson } from '@/components/admin/feedback/detail/post-utils'
import { HelpCenterFormFields } from './help-center-form-fields'
import {
  HelpCenterMetadataSidebar,
  HelpCenterMetadataSidebarContent,
} from './help-center-metadata-sidebar'
import type { HelpCenterArticleId } from '@quackback/ids'
import type { JSONContent } from '@tiptap/react'

interface HelpCenterArticleEditorProps {
  articleId: HelpCenterArticleId
}

/**
 * Full-page editor for a help center article.
 *
 * This is the page-mode counterpart to the old `HelpCenterArticleModal`.
 * The TipTap editor gets the full viewport width, which gives bubble menus,
 * slash menus, and table editing enough room to render without clipping.
 */
export function HelpCenterArticleEditor({ articleId }: HelpCenterArticleEditorProps) {
  const navigate = useNavigate()
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
      setContentJson(getInitialContentJson(article))
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
    updateArticleMutation.mutate({
      id: articleId,
      title: data.title,
      content: data.content,
      contentJson: contentJson as TiptapContent | null,
      categoryId,
    })
  })

  const handleBack = useCallback(() => {
    // Return to the category the article lives in so the user lands where
    // they came from. If we don't have the article yet (still loading),
    // fall back to the help center root.
    if (article?.categoryId) {
      void navigate({
        to: '/admin/help-center',
        search: { category: article.categoryId },
      })
    } else {
      void navigate({ to: '/admin/help-center' })
    }
  }, [article?.categoryId, navigate])

  const handleKeyDown = useKeyboardSubmit(handleSubmit)

  if (isLoading || !article) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <Form {...form}>
      <form onSubmit={handleSubmit} onKeyDown={handleKeyDown} className="flex flex-col h-full">
        {/* Top bar: back button + title crumbs + save controls */}
        <div className="border-b border-border/50 px-4 py-3 flex items-center gap-3 shrink-0">
          <Button type="button" variant="ghost" size="sm" onClick={handleBack}>
            <ArrowLeftIcon className="h-4 w-4 mr-1" />
            Back
          </Button>
          <div className="flex items-center gap-2 text-sm text-muted-foreground min-w-0">
            <Link
              to="/admin/help-center"
              className="hover:text-foreground transition-colors truncate"
            >
              Help Center
            </Link>
            <span className="shrink-0">/</span>
            {article.category && (
              <>
                <Link
                  to="/admin/help-center"
                  search={{ category: article.categoryId }}
                  className="hover:text-foreground transition-colors truncate"
                >
                  {article.category.name}
                </Link>
                <span className="shrink-0">/</span>
              </>
            )}
            <span className="text-foreground truncate">{article.title || 'Untitled'}</span>
          </div>
          <div className="ml-auto flex items-center gap-2 shrink-0">
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
                    authorName={article.author?.name}
                  />
                </div>
              </SheetContent>
            </Sheet>
            <Button type="submit" size="sm" disabled={updateArticleMutation.isPending}>
              {updateArticleMutation.isPending ? 'Saving\u2026' : 'Save changes'}
            </Button>
          </div>
        </div>

        {/* Content + metadata sidebar */}
        <div className="flex flex-1 min-h-0">
          <div className="flex-1 overflow-y-auto">
            {/* Constrain the editing surface to a reader-friendly width so the
                admin view mirrors the way articles actually render on the portal. */}
            <div className="mx-auto w-full max-w-4xl">
              <HelpCenterFormFields
                form={form}
                contentJson={contentJson}
                onContentChange={handleContentChange}
                error={
                  updateArticleMutation.isError ? updateArticleMutation.error.message : undefined
                }
              />
            </div>
          </div>

          <HelpCenterMetadataSidebar
            categoryId={categoryId}
            onCategoryChange={handleCategoryChange}
            isPublished={isPublished}
            onPublishToggle={handlePublishToggle}
            authorName={article.author?.name}
          />
        </div>
      </form>
    </Form>
  )
}
