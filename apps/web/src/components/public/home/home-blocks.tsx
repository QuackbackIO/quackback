/**
 * Home's blocks. Each shows live data in the brand's cards and type, sizes
 * itself on the six-column grid, and draws nothing when its page is off or it
 * has nothing to show. Every block is a `home-block` part and a section the
 * Appearance preview can select.
 */
import { createContext, Suspense, useContext, type CSSProperties, type ReactNode } from 'react'
import { Link, useNavigate, useRouteContext } from '@tanstack/react-router'
import { useQuery, useSuspenseInfiniteQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { RichTextContent } from '@/components/ui/rich-text-content'
import { StatusBadge, useStatusColour } from '@/components/ui/status-badge'
import { HelpCenterCategoryGrid } from '@/components/help-center/help-center-category-grid'
import { HelpCenterHeroSearch } from '@/components/help-center/help-center-search'
import { AuthVoteButton } from '@/components/public/auth-vote-button'
import { useSessionContext } from '@/lib/client/hooks/use-root-context'
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
import type { PostId } from '@quackback/ids'
import { cn } from '@/lib/shared/utils'
import { FeedbackHeaderAnimated } from '@/components/public/feedback/feedback-header-animated'
import { homeMessages } from './home-messages'
import { filledSpans } from '@/lib/shared/design/home-spans'
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
const MEDIUM_SPAN: Record<number, string> = { 1: 'md:col-span-1', 2: 'md:col-span-2' }
const WIDE_SPAN: Record<number, string> = {
  2: 'lg:col-span-2',
  3: 'lg:col-span-3',
  4: 'lg:col-span-4',
  5: 'lg:col-span-5',
  6: 'lg:col-span-6',
}

/** Each shown block's columns, by its index, once Home's rows are filled. */
const SpansContext = createContext<ReadonlyMap<number, string>>(new Map())

/**
 * The columns of the blocks Home shows, by index: a block whose page is off
 * is left out first, so its neighbours fill the row instead of leaving a hole.
 */
export function HomeSpans({
  blocks,
  gates,
  skip,
  children,
}: {
  blocks: HomeBlock[]
  gates: PortalPageGates
  /** A block drawn elsewhere, such as the composer in the band. */
  skip?: number
  children: ReactNode
}) {
  const shown = blocks
    .map((block, index) => ({ block, index }))
    .filter(({ block, index }) => index !== skip && blockShown(block, gates))
  const widths = shown.map(({ block }) => block.width)
  const [medium, wide] = [filledSpans(widths, 'medium'), filledSpans(widths, 'wide')]
  const spans = new Map(
    shown.map(({ index }, at) => [index, `${MEDIUM_SPAN[medium[at]!]} ${WIDE_SPAN[wide[at]!]}`])
  )
  return <SpansContext.Provider value={spans}>{children}</SpansContext.Provider>
}

const useSpan = (block: HomeBlock, index: number) =>
  useContext(SpansContext).get(index) ?? WIDTH_CLASS[block.width]

/** A roadmap column's status colour, as the design shows status colours. */
function StatusDot({ colour }: { colour: string | null | undefined }) {
  const shown = useStatusColour(colour)
  return (
    <span
      aria-hidden="true"
      data-qb-status-dot=""
      className="size-2 rounded-full bg-[var(--qb-status)]"
      style={shown ? ({ '--qb-status': shown } as CSSProperties) : undefined}
    />
  )
}

function BlockCard({
  block,
  index,
  title,
  action,
  bare = false,
  row = false,
  children,
}: {
  block: HomeBlock
  index: number
  title?: string
  action?: { label: string; to: string }
  /** A block that is already a card, such as the composer, takes no card of its own. */
  bare?: boolean
  /** A wide block's title, text and action on one line. */
  row?: boolean
  children: ReactNode
}) {
  const span = useSpan(block, index)
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
          '[[data-qb-cards=filled]_&]:border-transparent [[data-qb-cards=filled]_&]:shadow-none [[data-qb-cards=filled]_&]:rounded-[calc(var(--qb-radius-panel,0.75rem)*1.6)]',
        ],
        row && 'md:flex-row md:items-center md:gap-6 md:[&>p]:flex-1',
        span
      )}
    >
      {title && <h2 className="text-lg font-semibold text-foreground">{title}</h2>}
      {children}
      {action && (
        <Link
          to={action.to}
          className={cn(
            'mt-auto pt-1 text-sm font-medium text-[var(--qb-accent-text,var(--primary))] hover:underline',
            row && 'md:mt-0 md:shrink-0 md:pt-0'
          )}
        >
          {action.label}
        </Link>
      )}
    </section>
  )
}

/** A block waiting on its data: the card's outline, so the grid does not jump. */
function BlockSkeleton({ block, index }: { block: HomeBlock; index: number }) {
  const span = useSpan(block, index)
  return (
    <div
      aria-hidden="true"
      className={cn('col-span-1 min-h-32 animate-pulse rounded-lg bg-muted/40', span)}
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
  return (
    <BlockCard block={block} index={index} bare>
      <HomeComposer />
    </BlockCard>
  )
}

/**
 * Home's composer: the feed's own, in the brand's composer shape. It opens in
 * place to post an idea, and takes the visitor to it once posted. In the band
 * its button is filled, and on phones it takes a line of its own.
 */
export function HomeComposer({ inBand = false }: { inBand?: boolean }) {
  const navigate = useNavigate()
  const { data: boards } = useQuery(portalQueries.boards())
  const { data: capabilities } = useQuery(portalQueries.boardCapabilities())
  // Ideas go to the first board the visitor can post on, which they can change.
  const permissions = capabilities?.permissions
  const firstBoard =
    (boards ?? []).find((board) => permissions?.[board.id]?.canSubmit) ?? boards?.[0]
  return (
    <FeedbackHeaderAnimated
      workspaceName=""
      defaultBoardId={firstBoard?.id}
      boards={boards ?? []}
      boardPermissions={permissions}
      place={inBand ? 'band' : 'home'}
      onPostCreated={(postId, slug) =>
        void navigate({ to: '/b/$slug/posts/$postId', params: { slug, postId } })
      }
    />
  )
}

/** An idea's vote, by the rules the feed votes by: the board's, and the viewer's. */
function IdeaVote({ post }: { post: { id: PostId; voteCount: number; board?: { id: string } } }) {
  const session = useSessionContext()
  const { data } = useQuery(portalQueries.boardCapabilities())
  const isAuthenticated = !!session?.user && session.user.principalType !== 'anonymous'
  return (
    <AuthVoteButton
      postId={post.id}
      voteCount={post.voteCount}
      canVote={!!post.board && !!data?.permissions[post.board.id]?.canVote}
      isAuthenticated={isAuthenticated}
    />
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
                <IdeaVote post={post} />
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
              <StatusDot colour={column.color} />
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
  const askAiEnabled = useRouteContext({
    from: '__root__',
    select: (context) => !!context.settings?.featureFlags?.helpCenter,
  })
  return (
    <BlockCard
      block={block}
      index={index}
      title={intl.formatMessage(homeMessages.helpSearchTitle)}
      action={{ label: intl.formatMessage(homeMessages.helpAll), to: '/hc' }}
    >
      <HelpCenterHeroSearch askAiEnabled={askAiEnabled} size="block" />
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
      row={block.width === 'full'}
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
/** Whether a block's page is on, so Home draws it. */
export function blockShown(block: HomeBlock, gates: PortalPageGates): boolean {
  const page = BLOCK_PAGE[block.type]
  return !page || gates[page]
}

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
  if (!blockShown(block, gates)) return null
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
  return <Suspense fallback={<BlockSkeleton block={block} index={index} />}>{body}</Suspense>
}
