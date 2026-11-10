import { useIntl } from 'react-intl'
import { RssIcon } from '@heroicons/react/24/outline'
import { Button } from '@/components/ui/button'
import { PortalPageHeader } from '@/components/public/portal-page-header'
import { PortalPageTitle, useDesignTitles } from '@/components/public/portal-page-title'
import { usePageChoices } from '@/components/public/preview-draft-context'
import { useSessionContext } from '@/lib/client/hooks/use-root-context'
import { useAuthPopoverSafe } from '@/components/auth/auth-popover-context'
import { cn } from '@/lib/shared/utils'
import { ChangelogListPublic } from './changelog-list-public'
import { ChangelogSubscribeButton } from './changelog-subscribe-button'

/** The public changelog page: its title, subscribe and feed links, and the entries. */
export function ChangelogPage() {
  const intl = useIntl()
  const session = useSessionContext()
  const isIdentified = !!session?.user && session.user.principalType !== 'anonymous'
  const authPopover = useAuthPopoverSafe()

  const designTitles = useDesignTitles()
  const choices = usePageChoices().changelog
  const title = intl.formatMessage({ id: 'portal.changelog.title', defaultMessage: 'Changelog' })
  const description = intl.formatMessage({
    id: 'portal.changelog.description',
    defaultMessage: 'Stay up to date with the latest product updates and shipped features.',
  })
  const rss = intl.formatMessage({ id: 'portal.changelog.rssFeed', defaultMessage: 'RSS Feed' })
  // Subscribe by email leads; a visitor not signed in signs in to subscribe. RSS follows, quietly.
  const actions = (
    <div className="flex items-center gap-2">
      <ChangelogSubscribeButton
        enabled={isIdentified}
        onSignIn={authPopover ? () => authPopover.openAuthPopover({ mode: 'login' }) : undefined}
      />
      <Button variant="outline" size="icon-sm" asChild className="shrink-0">
        <a
          href="/changelog/feed"
          target="_blank"
          rel="noopener noreferrer"
          aria-label={rss}
          title={rss}
        >
          <RssIcon className="h-4 w-4" />
        </a>
      </Button>
    </div>
  )

  return (
    <>
      {designTitles && (
        <PortalPageTitle
          page="changelog"
          title={title}
          subtitle={description}
          action={actions}
          actionPlace={choices.subscribe}
        />
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
          <ChangelogListPublic
            entries={choices.entries}
            images={choices.images}
            shipped={choices.shipped}
          />
        </div>
      </div>
    </>
  )
}
