import { createFileRoute, notFound } from '@tanstack/react-router'
import { PageHeader } from '@/components/shared/page-header'
import { HelpCenterCategoryGrid } from '@/components/portal/help-center'
import type { FeatureFlags } from '@/lib/server/domains/settings/settings.types'

export const Route = createFileRoute('/_portal/help/')({
  loader: async ({ context }) => {
    const flags = context.settings?.featureFlags as FeatureFlags | undefined
    if (!flags?.helpCenter) throw notFound()

    return {
      workspaceName: context.settings?.name ?? 'Quackback',
      baseUrl: context.baseUrl ?? '',
    }
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {}
    const { workspaceName, baseUrl } = loaderData
    const title = `Help Center - ${workspaceName}`
    const description = `Find answers and guides for ${workspaceName}.`
    const canonicalUrl = baseUrl ? `${baseUrl}/help` : ''
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
  component: HelpCenterPage,
})

function HelpCenterPage() {
  return (
    <div className="py-8">
      <PageHeader
        size="large"
        title="Help Center"
        description="Find answers to your questions and learn how to get the most out of our product."
        animate
        className="mb-8"
      />

      <div
        className="animate-in fade-in duration-300 fill-mode-backwards"
        style={{ animationDelay: '100ms' }}
      >
        <HelpCenterCategoryGrid />
      </div>
    </div>
  )
}
