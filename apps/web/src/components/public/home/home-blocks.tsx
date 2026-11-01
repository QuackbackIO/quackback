/**
 * Home's blocks. Each shows live data in the brand's cards and type, sizes
 * itself on the six-column grid, and draws nothing when its page is off or it
 * has nothing to show. Every block is a `home-block` part and a section the
 * Appearance preview can select.
 */
import { Suspense, useState, type ReactNode } from 'react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useQuery, useSuspenseInfiniteQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { RichTextContent } from '@/components/ui/rich-text-content'
import { StatusBadge } from '@/components/ui/status-badge'
import { HelpCenterCategoryGrid } from '@/components/help-center/help-center-category-grid'
import { HelpCenterCompactSearch } from '@/components/help-center/help-center-search'
import { DEFAULT_LOCALE } from '@/lib/shared/i18n'
import { hcArticlePath } from '@/lib/shared/help-center-url'
import { COMPONENT_STATUS_STYLE, HERO_HEADLINE } from '@/components/portal/status/status-colors'
import { portalQueries } from '@/lib/client/queries/portal'
import { publicChangelogQueries } from '@/lib/client/queries/changelog'
import { publicHelpCenterQueries } from '@/lib/client/queries/help-center'
import { publicStatusPageQueries } from '@/lib/client/queries/status'
import {
  usePublicRoadmapPosts,
  flattenRoadmapViewPosts,
} from '@/lib/client/hooks/use-roadmap-posts-query'
import type { PortalPageGates } from '@/lib/shared/design/paths'
import { isEmptyTiptapDoc } from '@/lib/shared/utils/is-empty-tiptap-doc'
import type { TiptapContent } from '@/lib/shared/db-types'
import type { PortalDesign } from '@/lib/shared/design/schema'
import { cn } from '@/lib/shared/utils'
import { useFeedCopy } from '@/components/public/preview-draft-context'
import { homeMessages } from './home-messages'
import { popularArticlesQuery } from './home-prefetch'

export type HomeBlock = PortalDesign['pages']['home']['blocks'][number]

/** Where the feed lives while Home shows. */
const HOME_FEED_PATH = '/feedback'

/** Columns at each size: below md every block is full width, and thirds become halves until lg. */
const WIDTH_CLASS: Record<HomeBlock['width'], string> = {
  third: 'md:col-span-1 lg:col-span-2',
  half: 'md:col-span-1 lg:col-span-3',
  two_thirds: 'md:col-span-2 lg:col-span-4',
  full: 'md:col-span-2 lg:col-span-6',
}

/** A block's card: the brand's card style, its title and its way on. */
function BlockCard({
  block,
  index,
  title,
  action,
  bare = false,
  children,
}: {
  block: HomeBlock
  index: number
  title?: string
  action?: { label: string; to: string }
  /** A block that is already a card, such as the composer, takes no card of its own. */
  bare?: boolean
  children: ReactNode
}) {
  return (
    <section
      data-qb-section={`block-${index}`}
      data-qb-part="home-block"
      data-qb-block={block.type}
      className={cn(
        'col-span-1 flex min-w-0 flex-col gap-3',
        !bare && [
          'rounded-lg border border-border/40 bg-card p-[var(--qb-card-padding,1rem)] shadow-sm',
          '[[data-qb-cards=raised]_&]:border-transparent [[data-qb-cards=raised]_&]:shadow-md',
          '[[data-qb-cards=list]_&]:rounded-none [[data-qb-cards=list]_&]:border-x-0 [[data-qb-cards=list]_&]:border-t-0 [[data-qb-cards=list]_&]:bg-transparent [[data-qb-cards=list]_&]:shadow-none',
        ],
        WIDTH_CLASS[block.width]
      )}
    >
      {title && <h2 className="text-lg font-semibold text-foreground">{title}</h2>}
      {children}
      {action && (
        <Link
          to={action.to}
          className="mt-auto pt-1 text-sm font-medium text-[var(--qb-accent-text,var(--primary))] hover:underline"
        >
          {action.label}
        </Link>
      )}
    </section>
  )
}

/** A block waiting on its data: the card's outline, so the grid does not jump. */
function BlockSkeleton({ block }: { block: HomeBlock }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        'col-span-1 min-h-32 animate-pulse rounded-lg bg-muted/40',
        WIDTH_CLASS[block.width]
      )}
    />
  )
}

function WelcomeBlock({
  block,
  index,
}: {
  block: Extract<HomeBlock, { type: 'welcome' }>
  index: number
}) {
  if (isEmptyTiptapDoc(block.body as TiptapContent)) return null
  return (
    <BlockCard block={block} index={index}>
      <RichTextContent content={block.body as TiptapContent} />
    </BlockCard>
  )
}

/**
 * Share an idea: the feed's composer, collapsed. What a visitor types goes
 * with them to the feed, whose composer opens with it.
 */
function ComposerBlock({ block, index }: { block: HomeBlock; index: number }) {
  const intl = useIntl()
  const copy = useFeedCopy()
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const open = () =>
    void navigate({ to: HOME_FEED_PATH, state: { composeTitle: title.trim() } as never })
  return (
    <BlockCard block={block} index={index} bare>
      <form
        data-qb-part="composer"
        action={HOME_FEED_PATH}
        className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3.5 shadow-sm"
        onSubmit={(event) => {
          event.preventDefault()
          open()
        }}
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
          <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
            <path
              d="M11.1 2.3a1.6 1.6 0 0 1 2.3 2.3L5.6 12.4 2.5 13.5l1.1-3.1z"
              fill="currentColor"
            />
          </svg>
        </span>
        <input
          type="text"
          value={title}
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={copy.prompt ?? intl.formatMessage(homeMessages.composerPlaceholder)}
          aria-label={intl.formatMessage(homeMessages.composerLabel)}
          className="min-w-0 flex-1 border-0 bg-transparent font-semibold text-foreground outline-none placeholder:font-normal placeholder:text-muted-foreground/60"
        />
        <button
          type="submit"
          className="shrink-0 rounded-full px-3 py-1.5 text-sm font-medium text-[var(--qb-accent-text,var(--primary))] hover:bg-muted"
        >
          {copy.submit ?? intl.formatMessage(homeMessages.composerContinue)}
        </button>
      </form>
    </BlockCard>
  )
}

function IdeasBlock({
  block,
  index,
}: {
  block: Extract<HomeBlock, { type: 'ideas' }>
  index: number
}) {
  const intl = useIntl()
  const { data } = useSuspenseQuery(portalQueries.posts({ sort: block.sort }))
  const { data: statuses } = useQuery(portalQueries.statuses())
  const posts = data.items.slice(0, block.count)
  return (
    <BlockCard
      block={block}
      index={index}
      title={intl.formatMessage(homeMessages.ideasTitle)}
      action={{ label: intl.formatMessage(homeMessages.ideasAll), to: HOME_FEED_PATH }}
    >
      {posts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {intl.formatMessage(homeMessages.ideasEmpty)}
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {posts.map((post) => {
            const status = statuses?.find((candidate) => candidate.id === post.statusId)
            return (
              <li key={post.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                <span
                  data-qb-part="vote-button"
                  className="flex w-11 shrink-0 flex-col items-center justify-center rounded-md border py-1 text-sm font-semibold tabular-nums"
                >
                  {post.voteCount}
                </span>
                <span className="min-w-0">
                  {status && (
                    <StatusBadge name={status.name} color={status.color} className="mb-0.5" />
                  )}
                  <Link
                    to="/b/$slug/posts/$postId"
                    params={{ slug: post.board?.slug ?? '', postId: post.id }}
                    className="block truncate font-medium text-foreground hover:underline"
                  >
                    {post.title}
                  </Link>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </BlockCard>
  )
}

function RoadmapColumnPosts({
  roadmapId,
  statusId,
}: {
  roadmapId: Parameters<typeof usePublicRoadmapPosts>[0]['roadmapId']
  statusId: Parameters<typeof usePublicRoadmapPosts>[0]['statusId']
}) {
  const intl = useIntl()
  const { data } = usePublicRoadmapPosts({ roadmapId, statusId })
  const posts = flattenRoadmapViewPosts(data).slice(0, 2)
  if (posts.length === 0)
    return (
      <p className="text-xs text-muted-foreground">
        {intl.formatMessage(homeMessages.roadmapColumnEmpty)}
      </p>
    )
  return (
    <ul className="space-y-1.5">
      {posts.map((post) => (
        <li key={post.id}>
          <Link
            to="/b/$slug/posts/$postId"
            params={{ slug: post.board?.slug ?? '', postId: post.id }}
            className="line-clamp-2 text-sm text-foreground hover:underline"
          >
            {post.title}
          </Link>
        </li>
      ))}
    </ul>
  )
}

function RoadmapBlock({
  block,
  index,
}: {
  block: Extract<HomeBlock, { type: 'roadmap' }>
  index: number
}) {
  const intl = useIntl()
  const { data: roadmaps } = useSuspenseQuery(portalQueries.roadmaps())
  const roadmap = roadmaps.find((candidate) => candidate.id === block.roadmapId) ?? roadmaps[0]
  const columns = roadmap?.columns.filter((column) => column.statusId) ?? []
  if (!roadmap || columns.length === 0) return null
  return (
    <BlockCard
      block={block}
      index={index}
      title={roadmap.name}
      action={{ label: intl.formatMessage(homeMessages.roadmapAll), to: '/roadmap' }}
    >
      <div className="grid gap-4 sm:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]">
        {columns.map((column) => (
          <div key={column.id} className="min-w-0 space-y-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <span
                aria-hidden="true"
                className="size-2 rounded-full"
                style={{ backgroundColor: column.color }}
              />
              {column.name}
            </h3>
            <RoadmapColumnPosts roadmapId={roadmap.id} statusId={column.statusId ?? undefined} />
          </div>
        ))}
      </div>
    </BlockCard>
  )
}

function UpdatesBlock({
  block,
  index,
}: {
  block: Extract<HomeBlock, { type: 'updates' }>
  index: number
}) {
  const intl = useIntl()
  const { data } = useSuspenseInfiniteQuery(publicChangelogQueries.list())
  const entries = data.pages.flatMap((page) => page.items).slice(0, block.count)
  if (entries.length === 0) return null
  return (
    <BlockCard
      block={block}
      index={index}
      title={intl.formatMessage(homeMessages.updatesTitle)}
      action={{ label: intl.formatMessage(homeMessages.updatesAll), to: '/changelog' }}
    >
      <ul className="space-y-3">
        {entries.map((entry) => (
          <li key={entry.id} className="min-w-0">
            <Link
              to="/changelog/$entryId"
              params={{ entryId: entry.id }}
              className="block font-medium text-foreground hover:underline"
            >
              {entry.title}
            </Link>
            {entry.publishedAt && (
              <time dateTime={String(entry.publishedAt)} className="text-xs text-muted-foreground">
                {intl.formatDate(entry.publishedAt, { dateStyle: 'medium' })}
              </time>
            )}
          </li>
        ))}
      </ul>
    </BlockCard>
  )
}

function HelpSearchBlock({ block, index }: { block: HomeBlock; index: number }) {
  const intl = useIntl()
  const { data: articles } = useSuspenseQuery(popularArticlesQuery())
  return (
    <BlockCard
      block={block}
      index={index}
      title={intl.formatMessage(homeMessages.helpSearchTitle)}
      action={{ label: intl.formatMessage(homeMessages.helpAll), to: '/hc' }}
    >
      <HelpCenterCompactSearch />
      {articles.length > 0 && (
        <ul className="divide-y divide-border/60">
          {articles.map((article) => (
            <li key={article.id}>
              <Link
                to={
                  hcArticlePath({
                    locale: DEFAULT_LOCALE,
                    urlId: article.urlId,
                    slug: article.slug,
                  }) as '/hc'
                }
                className="flex items-baseline justify-between gap-3 py-2 text-sm hover:underline"
              >
                <span className="min-w-0 truncate font-medium text-foreground">
                  {article.title}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {article.categoryName}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </BlockCard>
  )
}

function HelpTopicsBlock({
  block,
  index,
}: {
  block: Extract<HomeBlock, { type: 'help_topics' }>
  index: number
}) {
  const intl = useIntl()
  const { data: categories } = useSuspenseQuery(publicHelpCenterQueries.categories())
  const chosen = block.categoryIds.length
    ? categories.filter((category) => block.categoryIds.includes(category.id as never))
    : categories.filter((category) => !category.parentId).slice(0, 8)
  if (chosen.length === 0) return null
  return (
    <BlockCard
      block={block}
      index={index}
      title={intl.formatMessage(homeMessages.helpTopicsTitle)}
      action={{ label: intl.formatMessage(homeMessages.helpAll), to: '/hc' }}
    >
      <HelpCenterCategoryGrid categories={chosen} />
    </BlockCard>
  )
}

function StatusBlock({ block, index }: { block: HomeBlock; index: number }) {
  const intl = useIntl()
  const { data } = useSuspenseQuery(publicStatusPageQueries.get())
  const { status, activeIncidentCount } = data.snapshot.topLevel
  const style = COMPONENT_STATUS_STYLE[status]
  return (
    <BlockCard
      block={block}
      index={index}
      title={intl.formatMessage(homeMessages.statusTitle)}
      action={{ label: intl.formatMessage(homeMessages.statusAll), to: '/status' }}
    >
      <p className={cn('flex items-center gap-2 font-medium', style.text)}>
        <span aria-hidden="true" className={cn('size-2.5 rounded-full', style.dot)} />
        {intl.formatMessage(HERO_HEADLINE[status])}
      </p>
      {activeIncidentCount > 0 && (
        <ul className="space-y-1 text-sm">
          {data.snapshot.activeIncidents.slice(0, 3).map((incident) => (
            <li key={incident.id}>
              <Link
                to="/status/$incidentId"
                params={{ incidentId: incident.id }}
                className="text-foreground hover:underline"
              >
                {incident.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </BlockCard>
  )
}

function ContactBlock({ block, index }: { block: HomeBlock; index: number }) {
  const intl = useIntl()
  return (
    <BlockCard
      block={block}
      index={index}
      title={intl.formatMessage(homeMessages.contactTitle)}
      action={{ label: intl.formatMessage(homeMessages.contactStart), to: '/support' }}
    >
      <p className="text-sm text-muted-foreground">
        {intl.formatMessage(homeMessages.contactBody)}
      </p>
    </BlockCard>
  )
}

function LinksBlock({
  block,
  index,
}: {
  block: Extract<HomeBlock, { type: 'links' }>
  index: number
}) {
  const intl = useIntl()
  return (
    <BlockCard
      block={block}
      index={index}
      title={block.title ?? intl.formatMessage(homeMessages.linksTitle)}
    >
      <ul className="space-y-2">
        {block.links.map((link) => (
          <li key={link.url}>
            <a
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-[var(--qb-accent-text,var(--primary))] hover:underline"
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </BlockCard>
  )
}

/** Which page a block depends on; a block whose page is off is not drawn. */
const BLOCK_PAGE: Partial<Record<HomeBlock['type'], keyof PortalPageGates>> = {
  composer: 'feedback',
  ideas: 'feedback',
  roadmap: 'roadmap',
  updates: 'changelog',
  help_search: 'help',
  help_topics: 'help',
  status: 'status',
  contact: 'support',
}

/** One block, drawn when its page is on, with its data streamed in. */
export function HomeBlockView({
  block,
  index,
  gates,
}: {
  block: HomeBlock
  index: number
  /** Which pages exist, from the loader; a block whose page is off is not drawn. */
  gates: PortalPageGates
}) {
  const page = BLOCK_PAGE[block.type]
  if (page && !gates[page]) return null
  const body = (() => {
    switch (block.type) {
      case 'welcome':
        return <WelcomeBlock block={block} index={index} />
      case 'composer':
        return <ComposerBlock block={block} index={index} />
      case 'ideas':
        return <IdeasBlock block={block} index={index} />
      case 'roadmap':
        return <RoadmapBlock block={block} index={index} />
      case 'updates':
        return <UpdatesBlock block={block} index={index} />
      case 'help_search':
        return <HelpSearchBlock block={block} index={index} />
      case 'help_topics':
        return <HelpTopicsBlock block={block} index={index} />
      case 'status':
        return <StatusBlock block={block} index={index} />
      case 'contact':
        return <ContactBlock block={block} index={index} />
      case 'links':
        return <LinksBlock block={block} index={index} />
    }
  })()
  return <Suspense fallback={<BlockSkeleton block={block} />}>{body}</Suspense>
}
