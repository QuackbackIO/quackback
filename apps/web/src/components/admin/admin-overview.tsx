import { Link, useRouteContext } from '@tanstack/react-router'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { inboxQueries } from '@/lib/client/queries/inbox'
import { mergeSuggestionQueries } from '@/lib/client/queries/signals'
import { statusOverviewQueries } from '@/lib/client/queries/status'
import { changelogQueries } from '@/lib/client/queries/changelog'
import { conversationInboxQueries } from '@/lib/client/queries/conversation-inbox'
import { helpCenterQueries } from '@/lib/client/queries/help-center'
import { adminQueries } from '@/lib/client/queries/admin'
import { defaultInboxFilters, inboxPostsInfiniteOptions } from '@/lib/client/hooks/use-inbox-query'
import { isProductEnabled, type FeatureFlags } from '@/lib/shared/types/settings'
import { homeModuleTitle } from '@/lib/shared/admin-home'
import { cn } from '@/lib/shared/utils'

export function AttentionRow({ flags }: { flags: Partial<FeatureFlags> | undefined }) {
  const supportOn = isProductEnabled(flags, 'support')
  const statusOn = isProductEnabled(flags, 'status')
  const inboxCounts = useQuery({
    ...inboxQueries.counts(),
    enabled: supportOn,
    retry: false,
  })
  const moderation = useQuery({
    ...adminQueries.moderationStatus(),
    retry: false,
  })
  const duplicates = useQuery({
    ...mergeSuggestionQueries.summary(),
    retry: false,
  })
  const status = useQuery({
    ...statusOverviewQueries.get(),
    enabled: statusOn,
    retry: false,
  })

  const chips: Array<{ href: string; label: string }> = []
  const unassigned = inboxCounts.data?.unassigned ?? 0
  const mine = inboxCounts.data?.mine ?? 0
  if (unassigned > 0) chips.push({ href: '/admin/inbox', label: `${unassigned} unassigned` })
  if (mine > 0) chips.push({ href: '/admin/inbox', label: `${mine} assigned to me` })
  const pending = moderation.data?.pendingCount ?? 0
  if (pending > 0) chips.push({ href: '/admin/moderation', label: `${pending} pending moderation` })
  const dupCount = duplicates.data?.count ?? 0
  if (dupCount > 0) {
    chips.push({ href: '/admin/feedback', label: `${dupCount} duplicate suggestions` })
  }
  const incidents = status.data?.activeIncidents.length ?? 0
  if (incidents > 0) chips.push({ href: '/admin/status', label: `${incidents} active incidents` })

  if (chips.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((chip) => (
        <Link
          key={`${chip.href}-${chip.label}`}
          to={chip.href}
          className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground no-underline hover:bg-muted/80"
        >
          {chip.label}
        </Link>
      ))}
    </div>
  )
}

export function RecentTiles({ flags }: { flags: Partial<FeatureFlags> | undefined }) {
  const tiles: Array<{ key: string; node: React.ReactNode }> = []
  if (isProductEnabled(flags, 'feedback')) {
    tiles.push({ key: 'feedback', node: <FeedbackTile /> })
  }
  if (isProductEnabled(flags, 'support')) {
    tiles.push({ key: 'support', node: <SupportTile /> })
  }
  if (isProductEnabled(flags, 'helpCenter')) {
    tiles.push({ key: 'help', node: <HelpCenterTile /> })
  }
  if (isProductEnabled(flags, 'changelog')) {
    tiles.push({ key: 'changelog', node: <ChangelogTile /> })
  }
  if (isProductEnabled(flags, 'status')) {
    tiles.push({ key: 'status', node: <StatusTile /> })
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {tiles.map((tile) => (
        <div key={tile.key}>{tile.node}</div>
      ))}
    </div>
  )
}

function HomeTile({
  title,
  href,
  children,
}: {
  title: string
  href: string
  children: React.ReactNode
}) {
  return (
    <section className="min-h-[140px] rounded-xl border bg-card p-5">
      <h3 className="text-sm font-semibold">
        <Link to={href} className="hover:underline">
          {title}
        </Link>
      </h3>
      <ul className="mt-3 list-none p-0">{children}</ul>
    </section>
  )
}

function TileRow({
  href,
  children,
  muted,
}: {
  href?: string
  children: React.ReactNode
  muted?: boolean
}) {
  const className = cn(
    'border-t border-border/70 py-2 text-[13px] first:border-t-0 first:pt-0',
    muted ? 'text-muted-foreground' : 'text-foreground'
  )
  if (!href) return <li className={className}>{children}</li>
  return (
    <li className={className}>
      <Link to={href} className="block truncate hover:underline">
        {children}
      </Link>
    </li>
  )
}

function FeedbackTile() {
  const posts = useInfiniteQuery(
    inboxPostsInfiniteOptions({ ...defaultInboxFilters, sort: 'newest' })
  )
  const items = posts.data?.pages[0]?.items.slice(0, 5) ?? []
  return (
    <HomeTile title={homeModuleTitle('feedback')} href="/admin/feedback">
      {items.length === 0 ? (
        <TileRow muted>No posts yet</TileRow>
      ) : (
        items.map((post) => (
          <TileRow key={post.id} href="/admin/feedback">
            {post.title}
          </TileRow>
        ))
      )}
    </HomeTile>
  )
}

function ChangelogTile() {
  const list = useInfiniteQuery(changelogQueries.list({ status: 'all' }))
  const items = list.data?.pages[0]?.items.slice(0, 5) ?? []
  return (
    <HomeTile title={homeModuleTitle('changelog')} href="/admin/changelog">
      {items.length === 0 ? (
        <TileRow muted>No updates yet</TileRow>
      ) : (
        items.map((entry) => (
          <TileRow key={entry.id} href="/admin/changelog">
            {entry.title}
          </TileRow>
        ))
      )}
    </HomeTile>
  )
}

function SupportTile() {
  const list = useQuery({
    ...conversationInboxQueries.conversationList({ kind: 'view', view: 'all' }, 'open', 'all', ''),
    retry: false,
  })
  const items = list.data?.conversations.slice(0, 5) ?? []
  return (
    <HomeTile title={homeModuleTitle('support')} href="/admin/inbox">
      {items.length === 0 ? (
        <TileRow muted>No conversations yet</TileRow>
      ) : (
        items.map((conversation) => (
          <TileRow key={conversation.id} href="/admin/inbox">
            {conversation.subject || conversation.lastMessagePreview || 'Conversation'}
          </TileRow>
        ))
      )}
    </HomeTile>
  )
}

function HelpCenterTile() {
  const list = useInfiniteQuery(helpCenterQueries.articleList({ sort: 'newest' }))
  const items = list.data?.pages[0]?.items.slice(0, 5) ?? []
  return (
    <HomeTile title={homeModuleTitle('helpCenter')} href="/admin/help-center">
      {items.length === 0 ? (
        <TileRow muted>No articles yet</TileRow>
      ) : (
        items.map((article) => (
          <TileRow key={article.id} href="/admin/help-center">
            {article.title}
          </TileRow>
        ))
      )}
    </HomeTile>
  )
}

function StatusTile() {
  const overview = useQuery({
    ...statusOverviewQueries.get(),
    retry: false,
  })
  const incidents = overview.data?.activeIncidents.slice(0, 5) ?? []
  return (
    <HomeTile title={homeModuleTitle('status')} href="/admin/status">
      {incidents.length > 0 ? (
        incidents.map((incident) => (
          <TileRow key={incident.id} href="/admin/status">
            {incident.title}
          </TileRow>
        ))
      ) : (
        <TileRow muted>All clear</TileRow>
      )}
    </HomeTile>
  )
}

export function useWorkspaceHomeTitle(): string {
  const { settings } = useRouteContext({ from: '__root__' })
  const branding = (settings as { brandingData?: { name?: string } } | undefined)?.brandingData
  return branding?.name ?? settings?.name ?? 'Home'
}
