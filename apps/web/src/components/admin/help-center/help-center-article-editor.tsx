import { useState, useCallback, useEffect } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useForm } from 'react-hook-form'
import { useQuery } from '@tanstack/react-query'
import { standardSchemaResolver } from '@hookform/resolvers/standard-schema'
import { Loader2 } from 'lucide-react'
import { ArrowLeftIcon } from '@heroicons/react/24/solid'
import { ArrowTopRightOnSquareIcon, EllipsisHorizontalIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { Form, FormControl, FormField, FormItem, FormMessage } from '@/components/ui/form'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { FormError } from '@/components/shared/form-error'
import { useImageUpload } from '@/lib/client/hooks/use-image-upload'
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
import { cn } from '@/lib/shared/utils'
import type { HelpCenterArticleId } from '@quackback/ids'
import type { JSONContent } from '@tiptap/react'

interface HelpCenterArticleEditorProps {
  articleId: HelpCenterArticleId
}

/**
 * Full-page editor for a help center article.
 *
 * Layout is inspired by Intercom / Notion: one slim top bar with
 * breadcrumbs + compact metadata controls + save/publish action; the
 * editing surface below is centered and reader-width so the admin view
 * mirrors how the article renders on the portal.
 */
export function HelpCenterArticleEditor({ articleId }: HelpCenterArticleEditorProps) {
  const navigate = useNavigate()
  const { upload: uploadImage } = useImageUpload({ prefix: 'help-center' })
  const [contentJson, setContentJson] = useState<JSONContent | null>(null)
  const [categoryId, setCategoryId] = useState('')
  const [isPublished, setIsPublished] = useState(false)
  const [hasInitialized, setHasInitialized] = useState(false)

  const updateArticleMutation = useUpdateArticle()
  const publishArticleMutation = usePublishArticle()
  const unpublishArticleMutation = useUnpublishArticle()

  const { data: article, isLoading } = useQuery({
    ...helpCenterQueries.articleDetail(articleId),
  })
  const { data: categories = [] } = useQuery(helpCenterQueries.categories())

  const form = useForm({
    resolver: standardSchemaResolver(updateArticleSchema),
    defaultValues: {
      id: articleId as string,
      title: '',
      description: '',
      content: '',
    },
  })

  useEffect(() => {
    if (article && !hasInitialized) {
      form.setValue('title', article.title)
      form.setValue('description', article.description ?? '')
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

  const handlePublish = useCallback(() => {
    publishArticleMutation.mutate(articleId, {
      onSuccess: () => setIsPublished(true),
    })
  }, [articleId, publishArticleMutation])

  const handleUnpublish = useCallback(() => {
    unpublishArticleMutation.mutate(articleId, {
      onSuccess: () => setIsPublished(false),
    })
  }, [articleId, unpublishArticleMutation])

  const handleSubmit = form.handleSubmit((data) => {
    updateArticleMutation.mutate({
      id: articleId,
      title: data.title,
      description: data.description?.trim() || undefined,
      content: data.content,
      contentJson: contentJson as TiptapContent | null,
      categoryId,
    })
  })

  const handleBack = useCallback(() => {
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

  const currentCategory = categories.find((c) => c.id === categoryId)
  const publicArticleUrl =
    article.category?.slug && article.slug ? `/hc/${article.category.slug}/${article.slug}` : null

  return (
    <Form {...form}>
      <form onSubmit={handleSubmit} onKeyDown={handleKeyDown} className="flex flex-col h-full">
        {/* Slim top bar: breadcrumbs + category + publish state + save */}
        <div className="border-b border-border/50 shrink-0">
          <div className="mx-auto w-full max-w-4xl px-4 py-2.5 flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleBack}
              className="h-8 px-2 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeftIcon className="h-4 w-4" />
            </Button>

            <div className="flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
              <Link
                to="/admin/help-center"
                className="hover:text-foreground transition-colors truncate"
              >
                Help Center
              </Link>
              {article.category && (
                <>
                  <span className="shrink-0 text-muted-foreground/50">/</span>
                  <Link
                    to="/admin/help-center"
                    search={{ category: article.categoryId }}
                    className="hover:text-foreground transition-colors truncate"
                  >
                    {article.category.name}
                  </Link>
                </>
              )}
            </div>

            <div className="ml-auto flex items-center gap-1.5 shrink-0">
              {/* Category pill */}
              <Select value={categoryId || undefined} onValueChange={handleCategoryChange}>
                <SelectTrigger
                  size="sm"
                  className="h-8 rounded-full text-xs px-3 min-w-0 max-w-[180px]"
                >
                  <SelectValue placeholder="Add to category...">
                    <span className="flex items-center gap-1.5 truncate">
                      {currentCategory?.icon && <span>{currentCategory.icon}</span>}
                      <span className="truncate">{currentCategory?.name ?? 'Category'}</span>
                    </span>
                  </SelectValue>
                </SelectTrigger>
                <SelectContent align="end">
                  {categories.map((cat) => (
                    <SelectItem key={cat.id} value={cat.id}>
                      <span className="flex items-center gap-1.5">
                        {cat.icon && <span>{cat.icon}</span>}
                        <span className="truncate">{cat.name}</span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Publish primary action — changes to "View article" once published */}
              {isPublished ? (
                <div className="flex items-center gap-1">
                  {publicArticleUrl && (
                    <a
                      href={publicArticleUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(
                        'inline-flex items-center gap-1.5 h-8 rounded-full text-xs px-3',
                        'border border-green-600/30 bg-green-600/10 text-green-700',
                        'hover:bg-green-600/20 hover:text-green-800',
                        'dark:text-green-400 dark:hover:text-green-300 transition-colors'
                      )}
                    >
                      <span className="h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden="true" />
                      View article
                      <ArrowTopRightOnSquareIcon className="h-3 w-3" />
                    </a>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8 w-8 p-0 rounded-full"
                        aria-label="Article actions"
                      >
                        <EllipsisHorizontalIcon className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={handleUnpublish}
                        disabled={unpublishArticleMutation.isPending}
                      >
                        {unpublishArticleMutation.isPending ? 'Unpublishing…' : 'Unpublish'}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handlePublish}
                  disabled={publishArticleMutation.isPending}
                  className="h-8 rounded-full text-xs px-3"
                >
                  {publishArticleMutation.isPending ? 'Publishing…' : 'Publish'}
                </Button>
              )}

              {/* Save primary action */}
              <Button
                type="submit"
                size="sm"
                disabled={updateArticleMutation.isPending}
                className="h-8 rounded-full text-xs px-3"
              >
                {updateArticleMutation.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </div>
        </div>

        {/* Editor body — constrained to reader width */}
        <ScrollArea className="flex-1">
          <div className="mx-auto w-full max-w-4xl px-6 sm:px-10 py-12">
            {updateArticleMutation.isError && (
              <FormError message={updateArticleMutation.error.message} className="mb-4" />
            )}

            {/* Big title */}
            <FormField
              control={form.control}
              name="title"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <input
                      type="text"
                      placeholder="Untitled"
                      autoFocus
                      className="w-full bg-transparent border-0 outline-none text-3xl sm:text-4xl font-bold tracking-tight text-foreground placeholder:text-muted-foreground/40 focus:ring-0 p-0"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Description / subtitle */}
            <FormField
              control={form.control}
              name="description"
              render={({ field }) => (
                <FormItem className="mt-2">
                  <FormControl>
                    <input
                      type="text"
                      placeholder="Page description (optional)"
                      className="w-full bg-transparent border-0 outline-none text-base sm:text-lg text-muted-foreground placeholder:text-muted-foreground/40 focus:ring-0 p-0"
                      {...field}
                      value={field.value ?? ''}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Body */}
            <div className="mt-8">
              <FormField
                control={form.control}
                name="content"
                render={() => (
                  <FormItem>
                    <FormControl>
                      <RichTextEditor
                        value={contentJson || ''}
                        onChange={handleContentChange}
                        placeholder="Start writing..."
                        minHeight="60vh"
                        borderless
                        features={{
                          headings: true,
                          images: true,
                          codeBlocks: true,
                          taskLists: true,
                          blockquotes: true,
                          tables: true,
                          dividers: true,
                          bubbleMenu: true,
                          slashMenu: true,
                          embeds: true,
                        }}
                        onImageUpload={uploadImage}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </div>
        </ScrollArea>
      </form>
    </Form>
  )
}
