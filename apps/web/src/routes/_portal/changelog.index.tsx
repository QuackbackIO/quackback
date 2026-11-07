import { createFileRoute, notFound } from '@tanstack/react-router'
import { ChangelogPage } from '@/components/portal/changelog/changelog-page'
import { isProductEnabled } from '@/lib/shared/types/settings'
import { setPublicDocumentCacheHeaders } from '@/lib/server/functions/public-cache'

export const Route = createFileRoute('/_portal/changelog/')({
  loader: async ({ context }) => {
    if (!isProductEnabled(context.settings?.featureFlags, 'changelog')) throw notFound()
    if (typeof window === 'undefined') await setPublicDocumentCacheHeaders()
    return {
      workspaceName: context.settings?.name ?? 'Quackback',
      baseUrl: context.baseUrl ?? '',
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
