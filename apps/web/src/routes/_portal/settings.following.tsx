import { useState } from 'react'
import { createFileRoute, Link, useRouter } from '@tanstack/react-router'
import { useIntl, FormattedMessage } from 'react-intl'
import { toast } from 'sonner'
import { BellIcon } from '@heroicons/react/24/solid'
import { PortalPageHeader } from '@/components/public/portal-page-header'
import { Button } from '@/components/ui/button'
import { getMyFollowingFn } from '@/lib/server/functions/following'
import { unsubscribeFromPostFn } from '@/lib/server/functions/subscriptions'
import { unwatchMyTicketFn } from '@/lib/server/functions/tickets'

export const Route = createFileRoute('/_portal/settings/following')({
  loader: () => getMyFollowingFn(),
  component: FollowingPage,
})

function FollowingPage() {
  const intl = useIntl()
  const router = useRouter()
  const { posts, tickets } = Route.useLoaderData()
  const [pending, setPending] = useState<string | null>(null)

  async function unfollow(id: string, action: () => Promise<unknown>) {
    setPending(id)
    try {
      await action()
      await router.invalidate()
    } catch {
      toast.error(
        intl.formatMessage({
          id: 'portal.settings.following.failed',
          defaultMessage: 'That did not work. Try again.',
        })
      )
    } finally {
      setPending(null)
    }
  }

  const unfollowLabel = intl.formatMessage({
    id: 'portal.settings.following.unfollow',
    defaultMessage: 'Unfollow',
  })

  return (
    <div className="space-y-6">
      <PortalPageHeader
        icon={BellIcon}
        title={intl.formatMessage({
          id: 'portal.settings.following.title',
          defaultMessage: 'Following',
        })}
        description={intl.formatMessage({
          id: 'portal.settings.following.description',
          defaultMessage: 'The posts and tickets you get updates about',
        })}
        animate
      />

      <section
        className="rounded-xl border border-border/50 bg-card p-6 shadow-sm animate-in fade-in duration-200 fill-mode-backwards"
        style={{ animationDelay: '75ms' }}
      >
        <h2 className="mb-4 font-medium">
          <FormattedMessage id="portal.settings.following.posts.title" defaultMessage="Posts" />
        </h2>
        {posts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            <FormattedMessage
              id="portal.settings.following.posts.empty"
              defaultMessage="You don't follow any posts yet. Use the bell on a post to follow it."
            />
          </p>
        ) : (
          <ul className="divide-y divide-border/50">
            {posts.map((post) => (
              <li key={post.postId} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <Link
                    to="/b/$slug/posts/$postId"
                    params={{ slug: post.boardSlug, postId: post.postId }}
                    className="block truncate text-sm font-medium text-foreground hover:underline"
                  >
                    {post.title}
                  </Link>
                  <p className="truncate text-xs text-muted-foreground">
                    {post.boardName}
                    {post.status && (
                      <>
                        {' · '}
                        <span
                          aria-hidden
                          className="me-1 inline-block size-2 rounded-full align-middle"
                          style={{ backgroundColor: post.status.color || undefined }}
                        />
                        {post.status.name}
                      </>
                    )}
                    {' · '}
                    {post.level === 'status_only' ? (
                      <FormattedMessage
                        id="portal.settings.following.level.statusOnly"
                        defaultMessage="Status changes only"
                      />
                    ) : (
                      <FormattedMessage
                        id="portal.settings.following.level.all"
                        defaultMessage="All activity"
                      />
                    )}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending === post.postId}
                  onClick={() =>
                    unfollow(post.postId, () =>
                      unsubscribeFromPostFn({ data: { postId: post.postId } })
                    )
                  }
                >
                  {unfollowLabel}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {tickets && (
        <section
          className="rounded-xl border border-border/50 bg-card p-6 shadow-sm animate-in fade-in duration-200 fill-mode-backwards"
          style={{ animationDelay: '150ms' }}
        >
          <h2 className="mb-4 font-medium">
            <FormattedMessage
              id="portal.settings.following.tickets.title"
              defaultMessage="Support tickets"
            />
          </h2>
          {tickets.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              <FormattedMessage
                id="portal.settings.following.tickets.empty"
                defaultMessage="You don't follow any tickets."
              />
            </p>
          ) : (
            <ul className="divide-y divide-border/50">
              {tickets.map((ticket) => (
                <li key={ticket.ticketId} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    {ticket.conversationId ? (
                      <Link
                        to="/support/$conversationId"
                        params={{ conversationId: ticket.conversationId }}
                        className="block truncate text-sm font-medium text-foreground hover:underline"
                      >
                        {ticket.title}
                      </Link>
                    ) : (
                      <p className="truncate text-sm font-medium text-foreground">{ticket.title}</p>
                    )}
                    <p className="truncate text-xs text-muted-foreground">
                      {ticket.reference}
                      {ticket.stage.label && ` · ${ticket.stage.label}`}
                      {ticket.relation === 'participant' && (
                        <>
                          {' · '}
                          <FormattedMessage
                            id="portal.support.sharedWithYou"
                            defaultMessage="Shared with you"
                          />
                        </>
                      )}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending === ticket.ticketId}
                    onClick={() =>
                      unfollow(ticket.ticketId, () =>
                        unwatchMyTicketFn({ data: { ticketId: ticket.ticketId } })
                      )
                    }
                  >
                    {unfollowLabel}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
