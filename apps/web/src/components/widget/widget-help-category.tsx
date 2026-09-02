import { useQuery } from '@tanstack/react-query'
import { FormattedMessage } from 'react-intl'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ChevronRightIcon } from '@heroicons/react/24/solid'
import { publicHelpCenterQueries } from '@/lib/client/queries/help-center'
import { CategoryIcon } from '@/components/help-center/category-icon'
import { WidgetHelpArticleListSkeleton } from './widget-skeletons'

interface WidgetHelpCategoryProps {
  categoryId: string
  categoryName: string
  categoryIcon: string | null
  onArticleSelect: (articleSlug: string) => void
}

export function WidgetHelpCategory({
  categoryId,
  categoryName,
  categoryIcon,
  onArticleSelect,
}: WidgetHelpCategoryProps) {
  const articlesQuery = useQuery(publicHelpCenterQueries.articlesForCategory(categoryId))
  // The collection list already has every category's description and icon;
  // read them from that cache so the header carries context (and an icon even
  // when we arrived from an article's eyebrow, which only knows id + name).
  const categoriesQuery = useQuery(publicHelpCenterQueries.categories())
  const category = categoriesQuery.data?.find((c) => c.id === categoryId)
  const icon = categoryIcon ?? category?.icon ?? null
  const articleCount = articlesQuery.data?.length ?? category?.articleCount

  return (
    <div className="flex flex-col h-full">
      {/* Category header */}
      <div className="px-3 pt-2 pb-2 shrink-0 border-b border-border/30">
        <div className="flex items-center gap-2">
          {icon && <CategoryIcon icon={icon} className="w-5 h-5 shrink-0" />}
          <h3 className="text-sm font-semibold text-foreground min-w-0 flex-1 truncate">
            {categoryName}
          </h3>
          {articleCount !== undefined && (
            <span className="shrink-0 text-[11px] text-muted-foreground/60 tabular-nums">
              <FormattedMessage
                id="widget.help.articleCount"
                defaultMessage="{count, plural, one {# article} other {# articles}}"
                values={{ count: articleCount }}
              />
            </span>
          )}
        </div>
        {category?.description && (
          <p className="mt-1 text-xs text-muted-foreground/70 line-clamp-2 leading-relaxed">
            {category.description}
          </p>
        )}
      </div>

      <ScrollArea scrollBarClassName="w-1.5" className="flex-1 min-h-0 h-full">
        <div className="px-3 pt-1 pb-3">
          {articlesQuery.isLoading && <WidgetHelpArticleListSkeleton />}

          {!articlesQuery.isLoading && (!articlesQuery.data || articlesQuery.data.length === 0) && (
            <div className="flex flex-col items-center justify-center py-8 text-center px-4">
              <p className="text-sm font-medium text-muted-foreground/70">
                <FormattedMessage
                  id="widget.help.noArticlesInCategory"
                  defaultMessage="No articles in this category"
                />
              </p>
            </div>
          )}

          {!articlesQuery.isLoading && articlesQuery.data && articlesQuery.data.length > 0 && (
            <div className="space-y-0.5">
              {articlesQuery.data.map((article) => (
                <button
                  key={article.id}
                  type="button"
                  onClick={() => onArticleSelect(article.slug)}
                  className="w-full text-start flex items-center gap-2 rounded-lg hover:bg-muted/30 transition-colors px-2.5 py-2.5 cursor-pointer group"
                >
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium text-foreground line-clamp-2 leading-snug">
                      {article.title}
                    </h3>
                    {article.description && (
                      <p className="text-xs text-muted-foreground/70 mt-0.5 line-clamp-2 leading-relaxed">
                        {article.description}
                      </p>
                    )}
                  </div>
                  <ChevronRightIcon className="w-3.5 h-3.5 text-muted-foreground/40 group-hover:text-muted-foreground/70 shrink-0 transition-colors" />
                </button>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
