import { createFileRoute, Link, notFound } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import { FormattedMessage, useIntl } from 'react-intl'
import { CheckBadgeIcon } from '@heroicons/react/24/solid'
import { ArrowTopRightOnSquareIcon } from '@heroicons/react/24/outline'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { StatusBadge } from '@/components/ui/status-badge'
import { TimeAgo } from '@/components/ui/time-ago'
import { getInitials } from '@/lib/shared/utils'
import { usePortalPermissions } from '@/lib/client/hooks/use-portal-permissions'
import { PERMISSIONS } from '@/lib/shared/permissions'
import {
  getPublicUserProfileFn,
  getProfileTeamContextFn,
  type PublicProfileActivityItemView,
} from '@/lib/server/functions/public-profile'

export const Route = createFileRoute('/_portal/u/$principalId')({
  loader: async ({ params, context }) => {
    // The fn composes portal access + viewer-scoped activity visibility;
    // every miss returns null, so this notFound() is shape-identical for
    // "no such user" and "nothing visible to you".
    const profile = await getPublicUserProfileFn({ data: { principalId: params.principalId } })
    if (!profile) {
      throw notFound()
    }
    return {
      profile,
      workspaceName: context.settings?.name ?? 'Quackback',
      baseUrl: context.baseUrl ?? '',
    }
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {}
    const { profile, workspaceName, baseUrl } = loaderData
    const title = `${profile.displayName || 'Profile'} - ${workspaceName}`
    const canonicalUrl = baseUrl ? `${baseUrl}/u/${profile.principalId}` : ''
    return {
      meta: [
        { title },
        // Profiles are viewer-dependent (activity is filtered per visitor);
        // keep them out of search indexes.
        { name: 'robots', content: 'noindex' },
      ],
      links: canonicalUrl ? [{ rel: 'canonical', href: canonicalUrl }] : [],
    }
  },
  notFoundComponent: ProfileNotFound,
  component: PublicProfilePage,
})

function ProfileNotFound() {
  return (
    <div className="mx-auto max-w-6xl w-full px-4 sm:px-6 py-16 text-center">
      <p className="text-lg font-medium">
        <FormattedMessage id="portal.profile.notFound" defaultMessage="Profile not found" />
      </p>
      <Link to="/" className="mt-4 inline-block text-sm text-primary hover:underline">
        <FormattedMessage id="portal.profile.backHome" defaultMessage="Back to feedback" />
      </Link>
    </div>
  )
}

function PublicProfilePage() {
  const intl = useIntl()
  const { profile } = Route.useLoaderData()
  const { can } = usePortalPermissions()
  const canViewPeople = can(PERMISSIONS.PEOPLE_VIEW)

  // Team-only context strip: fetched client-side, and only for viewers whose
  // resolved permission set includes people.view. The server fn re-enforces
  // the permission regardless of what the client does.
  const teamContextQuery = useQuery({
    queryKey: ['portal', 'profile-team-context', profile.principalId],
    queryFn: () => getProfileTeamContextFn({ data: { principalId: profile.principalId } }),
    enabled: canViewPeople,
    staleTime: 30_000,
  })
  const teamContext = canViewPeople ? (teamContextQuery.data ?? null) : null

  const memberSince = intl.formatDate(new Date(profile.joinedAt), {
    month: 'long',
    year: 'numeric',
  })

  return (
    <div className="mx-auto max-w-6xl w-full px-4 sm:px-6 py-8 space-y-4">
      {/* Profile header card */}
      <div className="rounded-xl border border-border/60 bg-card p-6 animate-in fade-in duration-200 fill-mode-backwards">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-6">
          <Avatar className="h-16 w-16 shrink-0">
            {profile.avatarUrl && <AvatarImage src={profile.avatarUrl} alt={profile.displayName} />}
            <AvatarFallback className="text-lg">{getInitials(profile.displayName)}</AvatarFallback>
          </Avatar>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold truncate">
                {profile.displayName ||
                  intl.formatMessage({
                    id: 'portal.profile.nameFallback',
                    defaultMessage: 'Anonymous',
                  })}
              </h1>
              {profile.isTeamMember && (
                <span className="inline-flex items-center gap-1 h-5 rounded-md bg-primary/15 px-1.5 text-xs font-medium text-primary">
                  <CheckBadgeIcon className="h-3.5 w-3.5" aria-hidden="true" />
                  <FormattedMessage id="portal.profile.teamBadge" defaultMessage="Team" />
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              <FormattedMessage
                id="portal.profile.memberSince"
                defaultMessage="Member since {date}"
                values={{ date: memberSince }}
              />
            </p>
          </div>

          {/* Stats wrap below the name on mobile (flex-col parent). */}
          <div className="flex items-center gap-8 sm:pr-2">
            <ProfileStat
              value={profile.postCount}
              label={intl.formatMessage({
                id: 'portal.profile.stats.posts',
                defaultMessage: 'Posts',
              })}
            />
            <ProfileStat
              value={profile.commentCount}
              label={intl.formatMessage({
                id: 'portal.profile.stats.comments',
                defaultMessage: 'Comments',
              })}
            />
            <ProfileStat
              value={profile.voteCount}
              label={intl.formatMessage({
                id: 'portal.profile.stats.upvotes',
                defaultMessage: 'Upvotes',
              })}
            />
          </div>
        </div>
      </div>

      {/* Team-only context strip — renders only when the people.view query
          returned data. Never part of the public payload. */}
      {teamContext && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span className="text-xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-400">
              <FormattedMessage id="portal.profile.teamStrip.label" defaultMessage="Team only" />
            </span>
            {teamContext.email && <span className="text-foreground">{teamContext.email}</span>}
            {teamContext.company && (
              <span className="text-foreground">
                {teamContext.company.name}
                {teamContext.company.plan && (
                  <span className="text-muted-foreground"> · {teamContext.company.plan}</span>
                )}
                {teamContext.company.mrrCents != null && (
                  <span className="text-muted-foreground">
                    {' '}
                    ·{' '}
                    {(teamContext.company.mrrCents / 100).toLocaleString('en-US', {
                      style: 'currency',
                      currency: 'USD',
                      maximumFractionDigits: 0,
                    })}
                    <FormattedMessage
                      id="portal.profile.teamStrip.mrrSuffix"
                      defaultMessage="/mo"
                    />
                  </span>
                )}
              </span>
            )}
            {teamContext.segments.length > 0 && (
              <span className="flex flex-wrap items-center gap-1.5">
                {teamContext.segments.map((segment) => (
                  <span
                    key={segment.id}
                    className="inline-flex items-center gap-1 rounded-full border border-border/60 bg-background px-2 py-0.5 text-xs"
                  >
                    <span
                      className="size-1.5 rounded-full"
                      style={{ backgroundColor: segment.color }}
                      aria-hidden="true"
                    />
                    {segment.name}
                  </span>
                ))}
              </span>
            )}
            <Link
              to="/admin/users"
              search={{ selected: profile.principalId }}
              className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <FormattedMessage
                id="portal.profile.teamStrip.openInAdmin"
                defaultMessage="Open in admin"
              />
              <ArrowTopRightOnSquareIcon className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </div>
        </div>
      )}

      {/* Activity tabs */}
      <Tabs defaultValue="posts" className="animate-in fade-in duration-300 fill-mode-backwards">
        <TabsList>
          <TabsTrigger value="posts">
            <FormattedMessage id="portal.profile.tabs.posts" defaultMessage="Posts" />
          </TabsTrigger>
          <TabsTrigger value="comments">
            <FormattedMessage id="portal.profile.tabs.comments" defaultMessage="Comments" />
          </TabsTrigger>
          <TabsTrigger value="upvoted">
            <FormattedMessage id="portal.profile.tabs.upvoted" defaultMessage="Upvoted" />
          </TabsTrigger>
        </TabsList>

        <TabsContent value="posts" className="mt-4">
          <ActivityList
            items={profile.posts}
            typeLabel={intl.formatMessage({
              id: 'portal.profile.activity.posted',
              defaultMessage: 'Posted',
            })}
            emptyMessage={intl.formatMessage({
              id: 'portal.profile.empty.posts',
              defaultMessage: 'No posts yet',
            })}
          />
        </TabsContent>
        <TabsContent value="comments" className="mt-4">
          <ActivityList
            items={profile.comments}
            typeLabel={intl.formatMessage({
              id: 'portal.profile.activity.commented',
              defaultMessage: 'Commented on',
            })}
            emptyMessage={intl.formatMessage({
              id: 'portal.profile.empty.comments',
              defaultMessage: 'No comments yet',
            })}
          />
        </TabsContent>
        <TabsContent value="upvoted" className="mt-4">
          <ActivityList
            items={profile.upvotes}
            typeLabel={intl.formatMessage({
              id: 'portal.profile.activity.upvoted',
              defaultMessage: 'Upvoted',
            })}
            emptyMessage={intl.formatMessage({
              id: 'portal.profile.empty.upvoted',
              defaultMessage: 'No upvotes yet',
            })}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function ProfileStat(props: { value: number; label: string }) {
  return (
    <div className="text-center">
      <div className="text-xl font-semibold tabular-nums">{props.value}</div>
      <div className="text-xs text-muted-foreground">{props.label}</div>
    </div>
  )
}

function ActivityList(props: {
  items: PublicProfileActivityItemView[]
  typeLabel: string
  emptyMessage: string
}) {
  if (props.items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border/60 px-4 py-10 text-center text-sm text-muted-foreground">
        {props.emptyMessage}
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {props.items.map((item) => (
        <Link
          key={`${item.postId}-${item.occurredAt}`}
          to="/b/$slug/posts/$postId"
          params={{ slug: item.boardSlug, postId: item.postId }}
          className="flex items-center gap-3 rounded-lg border border-border/50 bg-card px-4 py-3 transition-colors hover:bg-accent/50"
        >
          <span className="hidden sm:block w-28 shrink-0 text-xs text-muted-foreground">
            {props.typeLabel}
          </span>
          <span className="flex-1 min-w-0 truncate text-sm font-medium">{item.title}</span>
          {item.statusName && (
            <StatusBadge name={item.statusName} color={item.statusColor} className="shrink-0" />
          )}
          <TimeAgo
            date={item.occurredAt}
            className="hidden sm:block shrink-0 text-xs text-muted-foreground"
          />
        </Link>
      ))}
    </div>
  )
}
