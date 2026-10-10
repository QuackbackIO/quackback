import { Link } from '@tanstack/react-router'
import { useIntl } from 'react-intl'
import { ChatBubbleOvalLeftEllipsisIcon } from '@heroicons/react/24/outline'
import { EmptyState } from '@/components/shared/empty-state'
import { Button } from '@/components/ui/button'
import type { PortalNavItem } from './portal-header-nav'
import { usePortalNavItems } from './use-portal-nav-items'

/**
 * The portal home when the visitor can see no board. A workspace that runs
 * its help center, support or status page instead of a board points
 * visitors there rather than at a "coming soon" dead end.
 */
export function PortalNoBoards({ orgName, items }: { orgName: string; items: PortalNavItem[] }) {
  const intl = useIntl()
  // Feedback and Roadmap lead back to this same empty board.
  const elsewhere = items.filter(
    (item) => item.kind === 'builtin' && item.type !== 'feedback' && item.type !== 'roadmap'
  )

  if (elsewhere.length === 0) {
    return (
      <EmptyState
        icon={ChatBubbleOvalLeftEllipsisIcon}
        title={intl.formatMessage({
          id: 'portal.feedback.empty.comingSoonTitle',
          defaultMessage: 'Coming Soon',
        })}
        description={intl.formatMessage(
          {
            id: 'portal.feedback.empty.comingSoonDescription',
            defaultMessage:
              '{orgName} is setting up their feedback portal. Check back soon to share your ideas and suggestions.',
          },
          { orgName }
        )}
        className="py-24"
      />
    )
  }

  return (
    <EmptyState
      icon={ChatBubbleOvalLeftEllipsisIcon}
      title={intl.formatMessage({
        id: 'portal.feedback.empty.elsewhereTitle',
        defaultMessage: 'How can we help?',
      })}
      className="py-24"
      action={
        <div className="flex flex-wrap justify-center gap-2">
          {elsewhere.map((item) =>
            item.kind === 'builtin' ? (
              <Button key={item.id} variant="outline" asChild>
                <Link to={item.to}>
                  {item.label ??
                    intl.formatMessage({ id: item.messageId, defaultMessage: item.defaultMessage })}
                </Link>
              </Button>
            ) : null
          )}
        </div>
      }
    />
  )
}

/**
 * The empty home for the current viewer. It reads the nav itself so that only
 * the empty state, never the whole feed, follows the preview's nav draft.
 */
export function ViewerPortalNoBoards({ orgName }: { orgName: string }) {
  const items = usePortalNavItems()
  return <PortalNoBoards orgName={orgName} items={items} />
}
