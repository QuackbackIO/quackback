import { useState } from 'react'
import { useIntl, FormattedMessage } from 'react-intl'
import { useQuery } from '@tanstack/react-query'
import { contentPreview } from '@/lib/shared/utils/string'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  MagnifyingGlassIcon,
  QuestionMarkCircleIcon,
  ArrowRightIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline'
import { publicHelpCenterQueries } from '@/lib/client/queries/help-center'
import { getTopLevelCategories } from '@/components/help-center/help-center-utils'
import { CategoryIcon } from '@/components/help-center/category-icon'
import {
  AskAiAnswerPanel,
  AskAiRow,
  HighlightedText,
  useAskAiAvailable,
  useAskAiSearchController,
} from '@/components/help-center/ask-ai'
import { useKbSearch } from '@/components/help-center/use-kb-search'

interface WidgetHelpProps {
  onArticleSelect?: (articleSlug: string) => void
  onCategorySelect?: (categoryId: string, categoryName: string, categoryIcon: string | null) => void
}

export function WidgetHelp({ onArticleSelect, onCategorySelect }: WidgetHelpProps) {
  const intl = useIntl()
  const [search, setSearch] = useState('')

  const categoriesQuery = useQuery(publicHelpCenterQueries.categories())
  const topLevelCategories = categoriesQuery.data ? getTopLevelCategories(categoriesQuery.data) : []

  const askAiAvailable = useAskAiAvailable()
  // Widget locale passthrough (domains/languages §2): the search API falls
  // back to the default locale server-side if this locale isn't enabled.
  const { results, isSearching } = useKbSearch({ query: search, limit: 10, locale: intl.locale })
  const {
    askAiState,
    selectedIndex,
    hasAskRow,
    answerOpen,
    askRowOffset,
    triggerAsk,
    dismissAnswer,
    handleKeyDown,
  } = useAskAiSearchController({
    query: search,
    askAiAvailable,
    resultCount: results.length,
    onSelectResult: (idx) => {
      const article = results[idx]
      if (article) onArticleSelect?.(article.slug)
    },
    onClearQuery: () => setSearch(''),
  })

  const showCategories = !search && !isSearching

  return (
    <div className="flex flex-col h-full">
      {/* Search bar */}
      <div className="px-3 pt-2 pb-1 shrink-0">
        <div className="relative">
          <MagnifyingGlassIcon className="absolute start-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              askAiAvailable
                ? intl.formatMessage({
                    id: 'helpAskAi.searchPlaceholder',
                    defaultMessage: 'Ask AI or search our help articles to find an answer',
                  })
                : intl.formatMessage({
                    id: 'widget.help.searchPlaceholder',
                    defaultMessage: 'Search help articles...',
                  })
            }
            className="w-full ps-8 pe-9 py-2 text-sm bg-muted/30 border border-border/50 rounded-lg placeholder:text-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-transparent"
          />
          {hasAskRow && (
            <button
              type="button"
              onClick={triggerAsk}
              aria-label={intl.formatMessage({
                id: 'helpAskAi.rowSubtitle',
                defaultMessage: 'Use AI to answer your question in seconds',
              })}
              className="absolute end-1.5 top-1/2 -translate-y-1/2 flex size-6 items-center justify-center rounded-md bg-primary text-primary-foreground hover:opacity-90 transition-opacity cursor-pointer"
            >
              <ArrowRightIcon className="w-3.5 h-3.5 rtl:rotate-180" />
            </button>
          )}
        </div>
      </div>

      <ScrollArea scrollBarClassName="w-1.5" className="flex-1 min-h-0 h-full">
        <div className="px-3 pt-1 pb-3">
          {/* Category grid (default view) */}
          {showCategories && (
            <>
              {categoriesQuery.isLoading && (
                <div className="flex items-center justify-center py-8">
                  <span className="text-xs text-muted-foreground/50">
                    <FormattedMessage id="widget.help.loading" defaultMessage="Loading..." />
                  </span>
                </div>
              )}

              {!categoriesQuery.isLoading && topLevelCategories.length === 0 && (
                <div className="flex flex-col items-center justify-center py-8 text-center px-4">
                  <QuestionMarkCircleIcon className="w-8 h-8 text-muted-foreground/30 mb-2" />
                  <p className="text-sm font-medium text-muted-foreground/70">
                    <FormattedMessage
                      id="widget.help.noCategories"
                      defaultMessage="No articles yet"
                    />
                  </p>
                  <p className="text-xs text-muted-foreground/50 mt-0.5">
                    <FormattedMessage
                      id="widget.help.noCategoriesHint"
                      defaultMessage="Help articles will appear here once published."
                    />
                  </p>
                </div>
              )}

              {!categoriesQuery.isLoading && topLevelCategories.length > 0 && (
                <>
                  <p className="px-1 pt-2 pb-1 text-sm font-semibold text-foreground">
                    <FormattedMessage
                      id="widget.help.collectionsCount"
                      defaultMessage="{count, plural, one {# collection} other {# collections}}"
                      values={{ count: topLevelCategories.length }}
                    />
                  </p>
                  <ul>
                    {topLevelCategories.map((cat) => (
                      <li key={cat.id} className="border-b border-border/40 last:border-b-0">
                        <button
                          type="button"
                          onClick={() => onCategorySelect?.(cat.id, cat.name, cat.icon)}
                          className="group flex w-full items-center gap-3 rounded-lg px-2 py-3.5 text-start transition-colors hover:bg-muted/40 cursor-pointer"
                        >
                          <CategoryIcon icon={cat.icon} className="w-6 h-6 shrink-0" />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold text-foreground group-hover:text-primary transition-colors line-clamp-1">
                              {cat.name}
                            </span>
                            {cat.description && (
                              <span className="block text-xs text-muted-foreground/70 mt-0.5 line-clamp-2 leading-relaxed">
                                {cat.description}
                              </span>
                            )}
                            <span className="block text-[11px] text-muted-foreground/50 mt-1">
                              <FormattedMessage
                                id="widget.help.articleCount"
                                defaultMessage="{count, plural, one {# article} other {# articles}}"
                                values={{ count: cat.articleCount }}
                              />
                            </span>
                          </span>
                          <ChevronRightIcon className="w-4 h-4 shrink-0 text-muted-foreground/40 rtl:rotate-180" />
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}

          {/* Answer mode: the panel replaces the autocomplete results. */}
          {search && answerOpen && (
            <div className="pt-1">
              <AskAiAnswerPanel
                state={askAiState}
                onDismiss={dismissAnswer}
                onSourceClick={(source) => onArticleSelect?.(source.slug)}
              />
            </div>
          )}

          {/* Autocomplete mode */}
          {search && !answerOpen && (
            <>
              {/* Pinned Ask AI row: present whenever a query is typed. */}
              {hasAskRow && (
                <div className="pt-1 pb-1">
                  <AskAiRow
                    query={search}
                    onSelect={triggerAsk}
                    highlighted={selectedIndex === 0}
                  />
                </div>
              )}

              {isSearching && (
                <div className="flex items-center justify-center py-8">
                  <span className="text-xs text-muted-foreground/50">
                    <FormattedMessage id="widget.help.searching" defaultMessage="Searching..." />
                  </span>
                </div>
              )}

              {!isSearching && results.length === 0 && (
                <div className="flex flex-col items-center justify-center py-8 text-center px-4">
                  <QuestionMarkCircleIcon className="w-8 h-8 text-muted-foreground/30 mb-2" />
                  <p className="text-sm font-medium text-muted-foreground/70">
                    <FormattedMessage
                      id="widget.help.noResults"
                      defaultMessage="No results found"
                    />
                  </p>
                  <p className="text-xs text-muted-foreground/50 mt-0.5">
                    <FormattedMessage
                      id="widget.help.noResultsHint"
                      defaultMessage="Try different keywords or browse categories."
                    />
                  </p>
                </div>
              )}

              {!isSearching && results.length > 0 && (
                <div className="space-y-1">
                  {results.map((article, idx) => (
                    <button
                      key={article.id}
                      type="button"
                      onClick={() => onArticleSelect?.(article.slug)}
                      data-highlighted={selectedIndex === idx + askRowOffset || undefined}
                      className={`w-full text-start rounded-lg transition-colors px-2.5 py-2.5 cursor-pointer ${
                        selectedIndex === idx + askRowOffset ? 'bg-muted/50' : 'hover:bg-muted/30'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wide">
                          {article.category.name}
                        </span>
                      </div>
                      <h3 className="text-sm font-medium text-foreground line-clamp-2 leading-snug">
                        <HighlightedText text={article.title} query={search} />
                      </h3>
                      <p className="text-xs text-muted-foreground/70 mt-1 line-clamp-2 leading-relaxed">
                        <HighlightedText text={contentPreview(article.content)} query={search} />
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
