import { Link } from '@tanstack/react-router'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/shared/empty-state'
import { publicHelpCenterQueries } from '@/lib/client/queries/help-center'
import { QuestionMarkCircleIcon } from '@heroicons/react/24/outline'
import { stripMarkdownPreview } from '@/lib/shared/utils'

interface HelpCenterArticleListProps {
  categoryId: string
  categorySlug: string
}

export function HelpCenterArticleList({ categoryId, categorySlug }: HelpCenterArticleListProps) {
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useInfiniteQuery(
    publicHelpCenterQueries.articleList(categoryId)
  )

  const articles = data?.pages.flatMap((page) => page.items) ?? []

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-muted-foreground">Loading articles...</div>
      </div>
    )
  }

  if (articles.length === 0) {
    return (
      <EmptyState
        icon={QuestionMarkCircleIcon}
        title="No articles in this category"
        description="Check back soon for new help articles."
      />
    )
  }

  return (
    <div>
      <div className="divide-y divide-border/40">
        {articles.map((article, index) => (
          <Link
            key={article.id}
            to="/help/$categorySlug/$articleSlug"
            params={{ categorySlug, articleSlug: article.slug }}
            className="block py-5 first:pt-0 group animate-in fade-in duration-200 fill-mode-backwards"
            style={{ animationDelay: `${index * 50}ms` }}
          >
            <h3 className="text-base font-medium text-foreground group-hover:text-primary transition-colors">
              {article.title}
            </h3>
            <p className="text-sm text-muted-foreground/70 mt-1 line-clamp-2">
              {stripMarkdownPreview(article.content, 200)}
            </p>
          </Link>
        ))}
      </div>

      {hasNextPage && (
        <div className="flex justify-center pt-8">
          <Button variant="outline" onClick={() => fetchNextPage()} disabled={isFetchingNextPage}>
            {isFetchingNextPage ? 'Loading...' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  )
}
