import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useQueries, useQuery } from '@tanstack/react-query'
import { FormattedMessage } from 'react-intl'
import { ChatBubbleLeftRightIcon } from '@heroicons/react/24/outline'
import { useMemo } from 'react'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { HelpCenterHeroSearch } from '@/components/help-center/help-center-search'
import { HelpCenterCategoryGrid } from '@/components/help-center/help-center-category-grid'
import {
  listPublicCategoriesFn,
  listPublicCategoryEditorsFn,
} from '@/lib/server/functions/help-center'
import { getSupportSurfaceAccessFn } from '@/lib/server/functions/chat'
import type { HelpCenterConfig } from '@/lib/shared/types/settings'
import { publicHelpCenterQueries } from '@/lib/client/queries/help-center'

const searchSchema = z.object({
  categories: z.string().optional(),
})

export const Route = createFileRoute('/_portal/hc/')({
  validateSearch: searchSchema,
  loader: async ({ context }) => {
    const { settings } = context
    const helpCenterConfig = settings?.helpCenterConfig as HelpCenterConfig | undefined
    const [categories, editors] = await Promise.all([
      listPublicCategoriesFn({ data: {} }),
      listPublicCategoryEditorsFn({ data: {} }),
    ])

    return {
      categories,
      editors,
      helpCenterConfig: helpCenterConfig ?? null,
      workspaceName: settings?.name ?? 'Help Center',
      logoUrl: settings?.brandingData?.logoUrl || '/logo.png',
    }
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {}

    const { helpCenterConfig, workspaceName, logoUrl } = loaderData
    const title = helpCenterConfig?.homepageTitle ?? 'How can we help?'
    const description =
      helpCenterConfig?.homepageDescription ?? 'Search our knowledge base or browse by category'

    const pageTitle = `${title} - ${workspaceName}`

    return {
      meta: [
        { title: pageTitle },
        { name: 'description', content: description },
        { property: 'og:title', content: pageTitle },
        { property: 'og:description', content: description },
        { property: 'og:image', content: logoUrl },
        { name: 'twitter:title', content: pageTitle },
        { name: 'twitter:description', content: description },
      ],
    }
  },
  component: HelpCenterLandingPage,
})

function HelpCenterLandingPage() {
  const { categories, editors, helpCenterConfig } = Route.useLoaderData()
  const search = Route.useSearch()
  const navigate = useNavigate({ from: Route.fullPath })
  const { settings } = Route.useRouteContext()
  const supportConfigured =
    !!settings?.featureFlags?.supportInbox && !!settings?.portalConfig?.support?.enabled
  const supportAccess = useQuery({
    queryKey: ['portal', 'support-access'],
    queryFn: () => getSupportSurfaceAccessFn({ data: { surface: 'portal' } }),
    enabled: supportConfigured,
    staleTime: 30_000,
  })
  const supportEnabled = supportConfigured && (supportAccess.data?.granted ?? false)

  const title = helpCenterConfig?.homepageTitle ?? 'How can we help?'
  const description =
    helpCenterConfig?.homepageDescription ?? 'Search our knowledge base or browse by category'

  const availableCategoryIds = useMemo(
    () => categories.map((category) => category.id),
    [categories]
  )

  const selectedCategoryIds = useMemo(() => {
    const fromSearch = (search.categories ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
    if (fromSearch.length === 0) return availableCategoryIds
    const allowed = new Set<string>(availableCategoryIds)
    const filtered = fromSearch.filter((id) => allowed.has(id))
    return filtered.length > 0 ? filtered : availableCategoryIds
  }, [search.categories, availableCategoryIds])

  const selectedSet = useMemo(() => new Set(selectedCategoryIds), [selectedCategoryIds])

  function setSelectedCategoryIds(nextIds: string[]) {
    const unique = [...new Set(nextIds)]
    const normalized = unique.length >= availableCategoryIds.length ? [] : unique
    void navigate({
      search: (prev) => ({
        ...prev,
        categories: normalized.length > 0 ? normalized.join(',') : undefined,
      }),
      replace: true,
    })
  }

  const categoryArticleQueries = useQueries({
    queries: selectedCategoryIds.map((categoryId) => ({
      ...publicHelpCenterQueries.articlesForCategory(categoryId),
    })),
  })

  const selectedCategorySections = useMemo(
    () =>
      selectedCategoryIds.map((categoryId, index) => {
        const category = categories.find((item) => item.id === categoryId)
        return {
          category,
          articles: categoryArticleQueries[index]?.data ?? [],
          isLoading: categoryArticleQueries[index]?.isLoading ?? false,
        }
      }),
    [selectedCategoryIds, categories, categoryArticleQueries]
  )

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
      <div className="text-center mb-10 animate-in fade-in slide-in-from-bottom-2 duration-300">
        <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-3">{title}</h1>
        <p className="text-muted-foreground text-base mb-8">{description}</p>
        <HelpCenterHeroSearch />
      </div>

      <div
        className="animate-in fade-in duration-300 fill-mode-backwards"
        style={{ animationDelay: '100ms' }}
      >
        <HelpCenterCategoryGrid categories={categories} editors={editors} />
      </div>

      {categories.length > 0 && (
        <section className="mt-8 rounded-xl border border-border/60 bg-card p-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-foreground">Browse by selected categories</h2>
            {selectedCategoryIds.length !== availableCategoryIds.length && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setSelectedCategoryIds(availableCategoryIds)}
              >
                Show all
              </Button>
            )}
          </div>

          <div className="mb-5 flex flex-wrap gap-2">
            {categories.map((category) => {
              const selected = selectedSet.has(category.id)
              return (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => {
                    if (selected) {
                      setSelectedCategoryIds(selectedCategoryIds.filter((id) => id !== category.id))
                    } else {
                      setSelectedCategoryIds([...selectedCategoryIds, category.id])
                    }
                  }}
                  className={
                    selected
                      ? 'rounded-full border border-primary/40 bg-primary/10 px-3 py-1 text-xs font-medium text-primary'
                      : 'rounded-full border border-border/60 bg-background px-3 py-1 text-xs text-muted-foreground hover:text-foreground'
                  }
                >
                  {category.name}
                </button>
              )
            })}
          </div>

          <div className="space-y-5">
            {selectedCategorySections.map(({ category, articles, isLoading }) => {
              if (!category) return null
              const previewArticles = articles.slice(0, 6)
              return (
                <div
                  key={category.id}
                  className="rounded-lg border border-border/60 overflow-hidden"
                >
                  <div className="flex items-center justify-between gap-3 bg-muted/40 px-4 py-2.5">
                    <h3 className="text-sm font-semibold text-foreground">{category.name}</h3>
                    <Link
                      to="/hc/categories/$categorySlug"
                      params={{ categorySlug: category.slug }}
                      className="text-xs text-muted-foreground hover:text-foreground"
                    >
                      View category
                    </Link>
                  </div>
                  {isLoading ? (
                    <p className="px-4 py-3 text-sm text-muted-foreground">Loading entries…</p>
                  ) : previewArticles.length === 0 ? (
                    <p className="px-4 py-3 text-sm text-muted-foreground">
                      No entries in this category.
                    </p>
                  ) : (
                    <ul className="divide-y divide-border/50">
                      {previewArticles.map((article) => (
                        <li key={article.id}>
                          <Link
                            to="/hc/articles/$categorySlug/$articleSlug"
                            params={{ categorySlug: category.slug, articleSlug: article.slug }}
                            className="block px-4 py-3 text-sm text-foreground hover:bg-accent/40"
                          >
                            {article.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {supportEnabled && (
        <div
          className="mx-auto mt-12 flex max-w-2xl flex-wrap items-center justify-between gap-4 rounded-xl border border-border/60 bg-card px-6 py-5 animate-in fade-in duration-300 fill-mode-backwards"
          style={{ animationDelay: '150ms' }}
        >
          <div className="flex items-center gap-3">
            <ChatBubbleLeftRightIcon className="size-8 shrink-0 text-primary" />
            <div>
              <p className="text-sm font-semibold text-foreground">
                <FormattedMessage
                  id="portal.hc.contactSupport.title"
                  defaultMessage="Still need help?"
                />
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                <FormattedMessage
                  id="portal.hc.contactSupport.body"
                  defaultMessage="Start a conversation with our team and we'll get back to you."
                />
              </p>
            </div>
          </div>
          <Button asChild size="sm">
            <Link to="/support/$conversationId" params={{ conversationId: 'new' }}>
              <FormattedMessage
                id="portal.hc.contactSupport.cta"
                defaultMessage="Contact support"
              />
            </Link>
          </Button>
        </div>
      )}
    </div>
  )
}
