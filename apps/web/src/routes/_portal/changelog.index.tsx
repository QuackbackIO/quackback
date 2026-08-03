import { createFileRoute, redirect } from '@tanstack/react-router'
import { useIntl } from 'react-intl'
import { z } from 'zod'
import { RssIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/shared/page-header'
import { ChangelogListPublic } from '@/components/portal/changelog'

const searchSchema = z.object({
  category: z.string().optional(),
  product: z.string().optional(),
})

export const Route = createFileRoute('/_portal/changelog/')({
  validateSearch: searchSchema,
  beforeLoad: async ({ context }) => {
    // Check if changelog tab is enabled for the user
    const parentData = context as any
    const enabledTabs = parentData.enabledTabs || {}
    if (enabledTabs.changelog === false) {
      throw redirect({ to: '/' })
    }
  },
  loader: async ({ context }) => {
    const { getChangelogVisibilityForCurrentUserFn, listPublicChangelogTaxonomyFn } =
      await import('@/lib/server/functions/changelog')
    const [visibility, taxonomy] = await Promise.all([
      getChangelogVisibilityForCurrentUserFn(),
      listPublicChangelogTaxonomyFn(),
    ])
    return {
      workspaceName: context.settings?.name ?? 'Quackback',
      baseUrl: context.baseUrl ?? '',
      visibility,
      taxonomy,
    }
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {}
    const { workspaceName, baseUrl } = loaderData
    const title = `Changelog - ${workspaceName}`
    const description = `Stay up to date with the latest ${workspaceName} product updates and shipped features.`
    const canonicalUrl = baseUrl ? `${baseUrl}/changelog` : ''
    return {
      meta: [
        { title },
        { name: 'description', content: description },
        { property: 'og:title', content: title },
        { property: 'og:description', content: description },
        ...(canonicalUrl ? [{ property: 'og:url', content: canonicalUrl }] : []),
        { name: 'twitter:title', content: title },
        { name: 'twitter:description', content: description },
      ],
      links: canonicalUrl ? [{ rel: 'canonical', href: canonicalUrl }] : [],
    }
  },
  component: ChangelogPage,
})

function ChangelogPage() {
  const intl = useIntl()
  const { visibility, taxonomy } = Route.useLoaderData()
  const { category: selectedCategoryId, product: selectedProductId } = Route.useSearch()
  const navigate = Route.useNavigate()

  return (
    <div className="mx-auto max-w-6xl w-full px-4 sm:px-6 py-8">
      <PageHeader
        size="large"
        title={intl.formatMessage({ id: 'portal.changelog.title', defaultMessage: 'Changelog' })}
        description={intl.formatMessage({
          id: 'portal.changelog.description',
          defaultMessage: 'Stay up to date with the latest product updates and shipped features.',
        })}
        action={
          <Button variant="outline" size="sm" asChild className="shrink-0 gap-1.5">
            <a href="/changelog/feed" target="_blank" rel="noopener noreferrer">
              <RssIcon className="h-4 w-4" />
              <span className="hidden sm:inline">
                {intl.formatMessage({ id: 'portal.changelog.rssFeed', defaultMessage: 'RSS Feed' })}
              </span>
            </a>
          </Button>
        }
        animate
        className="mb-8"
      />

      <div
        className="animate-in fade-in duration-300 fill-mode-backwards"
        style={{ animationDelay: '100ms' }}
      >
        <ChangelogListPublic
          allowedCategoryIds={visibility.allowedCategoryIds}
          allowedProductIds={visibility.allowedProductIds}
          availableCategories={taxonomy.categories}
          availableProducts={taxonomy.products}
          selectedCategoryId={selectedCategoryId}
          selectedProductId={selectedProductId}
          onCategoryChange={(id) =>
            navigate({ search: (prev) => ({ ...prev, category: id, product: prev.product }) })
          }
          onProductChange={(id) =>
            navigate({ search: (prev) => ({ ...prev, category: prev.category, product: id }) })
          }
        />
      </div>
    </div>
  )
}
