import { useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { ChevronRightIcon } from '@heroicons/react/20/solid'
import { cn } from '@/lib/shared/utils'
import { Spinner } from '@/components/shared/spinner'
import { helpCenterQueries } from '@/lib/client/queries/help-center'
import { HelpCenterListItem } from './help-center-list-item'
import type { HelpCenterArticleId, HelpCenterCategoryId } from '@quackback/ids'

interface HelpCenterCategoryGroupProps {
  category: {
    id: HelpCenterCategoryId
    name: string
    icon: string | null
    articleCount: number
  }
  onNavigate: () => void
  onEditArticle: (id: HelpCenterArticleId) => void
  onDeleteArticle: (id: HelpCenterArticleId) => void
  /**
   * Initial expanded state. Defaults to false (collapsed).
   */
  defaultExpanded?: boolean
}

export function HelpCenterCategoryGroup({
  category,
  onNavigate,
  onEditArticle,
  onDeleteArticle,
  defaultExpanded = false,
}: HelpCenterCategoryGroupProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  // Only fetch when expanded (saves bandwidth on collapsed groups).
  const { data, isLoading } = useInfiniteQuery({
    ...helpCenterQueries.articleList({ categoryId: category.id }),
    enabled: expanded,
  })

  const articles = data?.pages[0]?.items ?? []
  const hasMore = (data?.pages[0]?.hasMore ?? false) || (data?.pages?.length ?? 0) > 1

  return (
    <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
      <div className="flex items-center">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="shrink-0 p-3 text-muted-foreground hover:text-foreground transition-colors"
          aria-label={expanded ? 'Collapse' : 'Expand'}
          aria-expanded={expanded}
        >
          <ChevronRightIcon
            className={cn('h-4 w-4 transition-transform', expanded && 'rotate-90')}
          />
        </button>
        <button
          type="button"
          onClick={onNavigate}
          className="flex-1 flex items-center gap-2 py-3 pr-3 text-left hover:bg-muted/40 transition-colors"
        >
          <span className="text-xl shrink-0">{category.icon || '📁'}</span>
          <span className="font-medium text-sm text-foreground truncate">{category.name}</span>
          <span className="text-xs text-muted-foreground ml-auto shrink-0">
            {category.articleCount} article{category.articleCount === 1 ? '' : 's'}
          </span>
        </button>
      </div>

      {expanded && (
        <div className="border-t border-border/50">
          {isLoading ? (
            <div className="flex justify-center py-4">
              <Spinner />
            </div>
          ) : articles.length === 0 ? (
            <p className="text-xs text-muted-foreground px-4 py-3">No articles in this category.</p>
          ) : (
            <div className="divide-y divide-border/50">
              {articles.map((article) => (
                <HelpCenterListItem
                  key={article.id}
                  id={article.id as HelpCenterArticleId}
                  title={article.title}
                  content={article.content}
                  publishedAt={article.publishedAt}
                  createdAt={article.createdAt}
                  category={article.category}
                  author={article.author}
                  viewCount={article.viewCount}
                  helpfulCount={article.helpfulCount}
                  onEdit={onEditArticle}
                  onDelete={onDeleteArticle}
                />
              ))}
            </div>
          )}
          {hasMore && (
            <button
              type="button"
              onClick={onNavigate}
              className="w-full text-center py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors border-t border-border/50"
            >
              See all {category.articleCount} articles in {category.name}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
