import { createFileRoute } from '@tanstack/react-router'
import { HelpCenterHeroSearch } from '@/components/help-center/help-center-search'
import { HelpCenterCategoryGrid } from '@/components/help-center/help-center-category-grid'
import { listPublicCategoriesFn } from '@/lib/server/functions/help-center'
import type { HelpCenterConfig } from '@/lib/server/domains/settings'

export const Route = createFileRoute('/_helpcenter/')({
  loader: async ({ context }) => {
    const { settings } = context
    const helpCenterConfig = settings?.helpCenterConfig as HelpCenterConfig | undefined
    const categories = await listPublicCategoriesFn({ data: {} })

    return {
      categories,
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
  const { categories, helpCenterConfig } = Route.useLoaderData()

  const title = helpCenterConfig?.homepageTitle ?? 'How can we help?'
  const description =
    helpCenterConfig?.homepageDescription ?? 'Search our knowledge base or browse by category'

  return (
    <div className="py-8">
      {/* Hero Section */}
      <div className="text-center mb-12">
        <h1 className="text-3xl sm:text-4xl font-bold text-foreground mb-3 animate-in fade-in slide-in-from-bottom-2 duration-300">
          {title}
        </h1>
        <p
          className="text-muted-foreground text-lg mb-8 animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-backwards"
          style={{ animationDelay: '50ms' }}
        >
          {description}
        </p>
        <div
          className="animate-in fade-in slide-in-from-bottom-2 duration-300 fill-mode-backwards"
          style={{ animationDelay: '100ms' }}
        >
          <HelpCenterHeroSearch />
        </div>
      </div>

      {/* Category Grid */}
      <div
        className="animate-in fade-in duration-300 fill-mode-backwards"
        style={{ animationDelay: '150ms' }}
      >
        <HelpCenterCategoryGrid categories={categories} />
      </div>
    </div>
  )
}
