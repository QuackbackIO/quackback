import { createFileRoute } from '@tanstack/react-router'
import { RssIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { PageHeader } from '@/components/shared/page-header'
import { ChangelogListPublic } from '@/components/portal/changelog'

export const Route = createFileRoute('/_portal/changelog/')({
  loader: async ({ context }) => {
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

function ChangelogPage() {
  return (
    <div className="py-8">
      <PageHeader
        size="large"
        title="Changelog"
        description="Stay up to date with the latest product updates and shipped features."
        action={
          <Button variant="outline" size="sm" asChild className="shrink-0 gap-1.5">
            <a href="/changelog/feed" target="_blank" rel="noopener noreferrer">
              <RssIcon className="h-4 w-4" />
              <span className="hidden sm:inline">RSS Feed</span>
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
        <ChangelogListPublic />
      </div>
    </div>
  )
}
