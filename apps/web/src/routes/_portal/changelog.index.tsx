import { createFileRoute, notFound } from '@tanstack/react-router'
import { useIntl } from 'react-intl'
import { RssIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { PortalPageHeader } from '@/components/public/portal-page-header'
import { PortalPageTitle, useDesignTitles } from '@/components/public/portal-page-title'
import { cn } from '@/lib/shared/utils'
import { ChangelogListPublic, ChangelogSubscribeButton } from '@/components/portal/changelog'
import { isProductEnabled } from '@/lib/shared/types/settings'
import { setPublicDocumentCacheHeaders } from '@/lib/server/functions/public-cache'
import { useSessionContext } from '@/lib/client/hooks/use-root-context'

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

function ChangelogPage() {
  const intl = useIntl()
  const session = useSessionContext()
  const isIdentified = !!session?.user && session.user.principalType !== 'anonymous'

  const designTitles = useDesignTitles()
  const title = intl.formatMessage({ id: 'portal.changelog.title', defaultMessage: 'Changelog' })
  const description = intl.formatMessage({
    id: 'portal.changelog.description',
    defaultMessage: 'Stay up to date with the latest product updates and shipped features.',
  })
  const actions = (
    <div className="flex items-center gap-2">
      <ChangelogSubscribeButton enabled={isIdentified} />
      <Button variant="outline" size="sm" asChild className="shrink-0 gap-1.5">
        <a href="/changelog/feed" target="_blank" rel="noopener noreferrer">
          <RssIcon className="h-4 w-4" />
          <span className="sr-only sm:not-sr-only">
            {intl.formatMessage({
              id: 'portal.changelog.rssFeed',
              defaultMessage: 'RSS Feed',
            })}
          </span>
        </a>
      </Button>
    </div>
  )

  return (
    <>
      {designTitles && (
        <PortalPageTitle page="changelog" title={title} subtitle={description} action={actions} />
      )}
      <div
        className={cn(
          'mx-auto max-w-[var(--qb-page-max,72rem)] w-full px-4 sm:px-6',
          designTitles ? 'pt-8 pb-8' : 'py-8'
        )}
      >
        {!designTitles && (
          <PortalPageHeader
            size="large"
            title={title}
            description={description}
            action={actions}
            animate
            className="mb-8"
          />
        )}

        <div
          className="animate-in fade-in duration-300 fill-mode-backwards"
          style={{ animationDelay: '100ms' }}
        >
          <ChangelogListPublic />
        </div>
      </div>
    </>
  )
}
