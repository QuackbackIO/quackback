/**
 * Home's blocks. Each shows live data in the brand's cards and type, takes
 * its place on Home's twelve-column grid, and draws nothing when its page is
 * off or it has nothing to show. Every block is a `home-block` part and a section the
 * Appearance preview can select.
 */
import { createContext, Suspense, useContext, type CSSProperties, type ReactNode } from 'react'
import { Link, useNavigate, useRouteContext } from '@tanstack/react-router'
import { useQuery, useSuspenseInfiniteQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useIntl } from 'react-intl'
import { RichTextContent } from '@/components/ui/rich-text-content'
import { StatusBadge, useStatusColour } from '@/components/ui/status-badge'
import {
  HelpCenterCategoryGrid,
  HelpCenterTopicsWithArticles,
} from '@/components/help-center/help-center-category-grid'
import { HelpCenterHeroSearch } from '@/components/help-center/help-center-search'
import { PortalVote } from '@/components/public/portal-vote'
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
import { FeedbackHeaderAnimated } from '@/components/public/feedback/feedback-header-animated'
import { homeMessages } from './home-messages'
import {
  SAMPLE_COLUMNS,
  SAMPLE_POSTS,
  SAMPLE_STATUS,
  SAMPLE_TOPICS,
  sampleEntries,
} from './home-samples'
import { usePreviewSamples } from '@/components/public/preview-draft-context'
import {
  chosenTopics,
  roadmapColumns,
  shows,
  statusHasComponents,
  whenEmptyOf,
  type DataBlock,
} from '@/lib/shared/design/block-content'
import { contentPreview } from '@/lib/shared/utils/string'
import { textForLocale } from '@/components/public/portal-band'
import {
  flowLayout,
  readingOrder,
  ROW_UNIT_PX,
  settle,
  TABLET_COLUMNS,
  type GridPlace,
} from '@/lib/shared/design/home-grid'
import { homeGridItems } from '@/lib/shared/design/home'
import { blockTintCss } from '@/lib/shared/design/tints'
import { popularArticlesQuery } from './home-prefetch'

export type HomeBlock = PortalDesign['pages']['home']['blocks'][number]

/** Where the feed lives while Home shows. */
const HOME_FEED_PATH = '/feedback'

/** A place as a CSS grid area: row start, column start, rows, columns. */
const areaOf = (place: GridPlace) =>
  `${place.y + 1} / ${place.x + 1} / span ${place.h} / span ${place.w}`

/** Places a block in its area on tablets and up; on phones blocks stack in reading order. */
const AREA_CLASS =
  'md:[grid-area:var(--qb-area-md)] md:max-lg:self-start lg:[grid-area:var(--qb-area-lg)]'

/**
 * A block left off phones (`look.phone.hidden`): gone below md for visitors,
 * and faded in the builder, where it stays to be picked.
 */
function phoneHiddenClass(block: HomeBlock, samples: boolean): string | false {
  if (block.look?.phone?.hidden !== true) return false
  return samples ? 'max-md:opacity-50' : 'max-md:hidden'
}

/** Home's grid: one column on phones, two on tablets, twelve from lg, rows at least a unit tall. */
export const HOME_GRID_CLASS =
  'grid grid-cols-1 md:grid-cols-2 md:auto-rows-[minmax(var(--qb-row),auto)] lg:grid-cols-12'
export const HOME_GRID_STYLE = { '--qb-row': `${ROW_UNIT_PX}px` } as CSSProperties

/** Each shown block's area at each size, by its index. */
const AreasContext = createContext<ReadonlyMap<number, CSSProperties>>(new Map())

/**
 * Where Home draws its blocks: the indexes it shows, in reading order, and
 * each one's area. A block whose page is off, or the composer in the band,
 * is left out first, and the rest float up into its room. Desktops use the
 * blocks' own places; tablets lay them out again on two columns.
 */
export function homeLayout(
  home: PortalDesign['pages']['home'],
  gates: PortalPageGates,
  /** Blocks that draw nothing, which the rest close up over. */
  leaveOut: ReadonlySet<number> = new Set()
): { order: number[]; areas: Map<number, CSSProperties> } {
  const indexOf = new Map(home.blocks.map((block, i) => [block.id ?? `#${i}`, i]))
  const shown = homeGridItems(home, gates).filter((item) => !leaveOut.has(indexOf.get(item.id)!))
  const wide = settle(shown)
  const medium = new Map(flowLayout(wide, TABLET_COLUMNS).map((item) => [item.id, item]))
  const order = readingOrder(wide)
  const areas = new Map(
    order.map((item) => [
      indexOf.get(item.id)!,
      {
        '--qb-area-lg': areaOf(item),
        '--qb-area-md': areaOf(medium.get(item.id)!),
      } as CSSProperties,
    ])
  )
  return { order: order.map((item) => indexOf.get(item.id)!), areas }
}

/** Gives Home's blocks their areas, from `homeLayout`. */
export function HomeAreas({
  areas,
  children,
}: {
  areas: ReadonlyMap<number, CSSProperties>
  children: ReactNode
}) {
  return <AreasContext.Provider value={areas}>{children}</AreasContext.Provider>
}

const useArea = (index: number) => useContext(AreasContext).get(index)

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

/**
 * A block in a tint of a brand colour, or in a brand colour with the text
 * that reads on it: the brand colour unless the look picks another, and the
 * brand colour where the design has no such colour. Set on the block itself,
 * so it holds whatever the site's card style draws.
 */
function toneStyle(
  tone: 'tint' | 'brand',
  role: NonNullable<HomeBlock['look']>['colour']
): CSSProperties {
  const accent = 'var(--qb-accent, var(--primary))'
  const onAccent = 'var(--qb-on-accent, var(--primary-foreground))'
  const own = role && role !== 'accent'
  const fill = own ? `var(--qb-role-${role}, ${accent})` : accent
  const ink = own ? `var(--qb-on-role-${role}, ${onAccent})` : onAccent
  if (tone === 'tint') return { background: blockTintCss(fill) }
  // The design CSS draws every part inside in --qb-tone-ink.
  return {
    '--qb-tone-fill': fill,
    '--qb-tone-ink': ink,
    background: 'var(--qb-tone-fill)',
    borderColor: 'transparent',
    color: 'var(--qb-tone-ink)',
  } as CSSProperties
}

function BlockCard({
  block,
  index,
  title,
  action,
  bare = false,
  row = false,
  sample = false,
  children,
}: {
  block: HomeBlock
  index: number
  title?: string
  action?: { label: string; to: string }
  /** What it shows is made up, in the builder alone, and it says so. */
  sample?: boolean
  /** A block that is already a card, such as the composer, takes no card of its own. */
  bare?: boolean
  /** A wide block's title, text and action on one line. */
  row?: boolean
  children: ReactNode
}) {
  const area = useArea(index)
  const intl = useIntl()
  const samples = usePreviewSamples()
  const key = `block-${block.id ?? index}`
  const tone = block.look?.tone
  const card = !bare && tone !== 'plain'
  // A heading in another language gives way to the block's usual one, in the visitor's.
  const heading = textForLocale(block.heading, intl.locale, { anyLanguage: false }) || title
  // Its way on in its own words, which are edited where they sit.
  const ownLink = 'link' in block ? block.link : undefined
  const linkLabel = textForLocale(ownLink, intl.locale, { anyLanguage: false }) || action?.label
  return (
    <section
      data-qb-section={key}
      data-qb-part="home-block"
      data-qb-block={block.type}
      data-qb-surface={card ? 'card' : undefined}
      data-qb-tone={tone}
      data-qb-phone-hidden={block.look?.phone?.hidden ? '' : undefined}
      style={{
        ...area,
        ...(tone === 'tint' || tone === 'brand' ? toneStyle(tone, block.look?.colour) : undefined),
      }}
      className={cn(
        'flex min-w-0 flex-col gap-3',
        AREA_CLASS,
        card &&
          'rounded-lg border border-border/40 bg-card p-[var(--qb-card-padding,1rem)] shadow-sm',
        row && 'md:flex-row md:items-center md:gap-6 md:[&>p]:flex-1',
        block.look?.align === 'centre' && 'items-center text-center',
        phoneHiddenClass(block, samples)
      )}
    >
      {heading && (
        <h2
          data-qb-part="section-heading"
          data-qb-words={block.id ? `${key}.heading` : undefined}
          className="text-lg font-semibold text-foreground"
        >
          {heading}
        </h2>
      )}
      {sample && <SampleTag />}
      {children}
      {action && (
        <Link
          to={action.to}
          data-qb-link=""
          data-qb-words={block.id ? `${key}.link` : undefined}
          className={cn(
            // A 24px target without moving the line it sits on.
            'relative mt-auto self-start pt-1 text-sm font-medium text-[var(--qb-accent-text,var(--primary))] hover:underline after:absolute after:inset-x-0 after:-bottom-1 after:top-0',
            row && 'md:mt-0 md:shrink-0 md:self-center md:pt-0'
          )}
        >
          {linkLabel}
        </Link>
      )}
    </section>
  )
}

/** A block waiting on its data: the card's outline, so the grid does not jump. */
function BlockSkeleton({ block, index }: { block: HomeBlock; index: number }) {
  const area = useArea(index)
  const samples = usePreviewSamples()
  return (
    <div
      aria-hidden="true"
      data-qb-skeleton={`block-${block.id ?? index}`}
      style={area}
      className={cn(
        'min-h-32 animate-pulse rounded-lg bg-muted/40',
        AREA_CLASS,
        phoneHiddenClass(block, samples)
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
  const samples = usePreviewSamples()
  if (isEmptyTiptapDoc(block.body as TiptapContent)) {
    // In the builder, a place to write it, edited where it sits; visitors see nothing.
    if (!samples || !block.id) return null
    return (
      <BlockCard block={block} index={index}>
        <div
          data-qb-words={`block-${block.id}.body`}
          data-qb-words-placeholder="Write a welcome"
          className="min-h-6 text-muted-foreground"
        />
      </BlockCard>
    )
  }
  return (
    <BlockCard block={block} index={index}>
      <RichTextContent
        content={block.body as TiptapContent}
        words={block.id ? `block-${block.id}.body` : undefined}
      />
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
export function HomeComposer({
  inBand = false,
  startOpen,
  onClose,
}: {
  inBand?: boolean
  /** Opened by a call to action, with its details showing; Cancel gives the call back. */
  startOpen?: boolean
  onClose?: () => void
}) {
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
      startOpen={startOpen}
      onClose={onClose}
      onPostCreated={(postId, slug) =>
        void navigate({ to: '/b/$slug/posts/$postId', params: { slug, postId } })
      }
    />
  )
}

/** A block's own words in the visitor's language, or none to give way to its usual ones. */
function useOwnWords(words: Record<string, string> | undefined): string {
  const intl = useIntl()
  return textForLocale(words, intl.locale, { anyLanguage: false }) ?? ''
}

/** What a block of the workspace's data says with nothing to show: its own words, or its usual. */
function EmptyWords({ block, usual }: { block: DataBlock; usual: string }) {
  const own = useOwnWords(block.emptyText)
  return (
    <p
      data-qb-words={block.id ? `block-${block.id}.empty` : undefined}
      className="text-sm text-muted-foreground"
    >
      {own || usual}
    </p>
  )
}

/**
 * How a block of the workspace's data draws with nothing to show: not at all,
 * its message, or (in the builder, for a block that hides) samples.
 */
function emptyDraw(block: DataBlock, samples: boolean): 'hide' | 'message' | 'samples' {
  const when = whenEmptyOf(block)
  if (when === 'message') return 'message'
  return samples ? 'samples' : 'hide'
}

/** Says that what a block shows is made up, in the builder alone. */
function SampleTag() {
  const intl = useIntl()
  return (
    <span
      data-qb-sample=""
      className="self-start rounded-full border border-dashed border-border px-2 py-0.5 text-xs font-medium text-muted-foreground"
    >
      {intl.formatMessage(homeMessages.sample)}
    </span>
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
  const samples = usePreviewSamples()
  const { data } = useSuspenseQuery(portalQueries.homeIdeas(block))
  const { data: statuses } = useQuery(portalQueries.statuses())
  const found = data.items.slice(0, block.count)
  const draw = found.length === 0 ? emptyDraw(block, samples) : null
  if (draw === 'hide') return null
  const sample = draw === 'samples'
  const posts = sample
    ? SAMPLE_POSTS.slice(0, block.count).map((post) => ({
        ...post,
        statusId: null,
        board: null,
      }))
    : found
  const votes = shows(block, 'showVotes')
  const withStatus = shows(block, 'showStatus')
  const comments = shows(block, 'showComments')
  // Posts only in shipped statuses are what was recently shipped.
  const shipped =
    !!block.statusIds?.length &&
    block.statusIds.every(
      (id) => statuses?.find((status) => status.id === id)?.category === 'complete'
    )
  return (
    <BlockCard
      block={block}
      index={index}
      sample={sample}
      title={intl.formatMessage(
        shipped
          ? homeMessages.ideasTitleShipped
          : block.sort === 'trending'
            ? homeMessages.ideasTitleTrending
            : block.sort === 'new'
              ? homeMessages.ideasTitleNew
              : homeMessages.ideasTitle
      )}
      action={{ label: intl.formatMessage(homeMessages.ideasAll), to: HOME_FEED_PATH }}
    >
      {draw === 'message' ? (
        <EmptyWords block={block} usual={intl.formatMessage(homeMessages.ideasEmpty)} />
      ) : (
        <ul className="divide-y divide-border/60">
          {posts.map((post) => {
            const status = sample
              ? SAMPLE_STATUS
              : statuses?.find((candidate) => candidate.id === post.statusId)
            return (
              <li key={post.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
                {votes && <PortalVote post={post} />}
                <span className="min-w-0">
                  {withStatus && status && (
                    <StatusBadge name={status.name} color={status.color} className="mb-0.5" />
                  )}
                  {sample ? (
                    <span className="block truncate font-medium text-foreground">{post.title}</span>
                  ) : (
                    <Link
                      to="/b/$slug/posts/$postId"
                      params={{ slug: post.board?.slug ?? '', postId: post.id }}
                      data-qb-item="post-title"
                      className="block truncate font-medium text-foreground hover:underline"
                    >
                      {post.title}
                    </Link>
                  )}
                  {comments && (
                    <span className="block text-xs text-muted-foreground">
                      {intl.formatMessage(homeMessages.ideasComments, {
                        count: post.commentCount ?? 0,
                      })}
                    </span>
                  )}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </BlockCard>
  )
}

/** A roadmap post's title, with its votes when the block shows them. */
function RoadmapPost({
  title,
  votes,
  link,
}: {
  title: string
  votes: number | null
  link?: { slug: string; postId: string }
}) {
  const intl = useIntl()
  const words = link ? (
    <Link
      to="/b/$slug/posts/$postId"
      params={link}
      data-qb-item="post-title"
      className="line-clamp-2 py-0.5 text-sm text-foreground hover:underline"
    >
      {title}
    </Link>
  ) : (
    <span className="line-clamp-2 py-0.5 text-sm text-foreground">{title}</span>
  )
  if (votes === null) return words
  return (
    <span className="flex items-baseline justify-between gap-2">
      {words}
      <span
        data-qb-live={link ? 'votes' : undefined}
        className="shrink-0 text-xs text-muted-foreground"
      >
        {intl.formatMessage(homeMessages.roadmapVotes, { count: votes })}
      </span>
    </span>
  )
}

function RoadmapColumnPosts({
  roadmapId,
  statusId,
  count,
  votes,
}: {
  roadmapId: Parameters<typeof usePublicRoadmapPosts>[0]['roadmapId']
  statusId: Parameters<typeof usePublicRoadmapPosts>[0]['statusId']
  count: number
  votes: boolean
}) {
  const intl = useIntl()
  const { data } = usePublicRoadmapPosts({ roadmapId, statusId })
  const posts = flattenRoadmapViewPosts(data).slice(0, count)
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
          <RoadmapPost
            title={post.title}
            votes={votes ? post.voteCount : null}
            link={{ slug: post.board?.slug ?? '', postId: post.id }}
          />
        </li>
      ))}
    </ul>
  )
}

/** Posts in each roadmap column, as the block says or as it always was. */
const PER_COLUMN = 2

function RoadmapBlock({
  block,
  index,
}: {
  block: Extract<HomeBlock, { type: 'roadmap' }>
  index: number
}) {
  const intl = useIntl()
  const samples = usePreviewSamples()
  const { data: roadmaps } = useSuspenseQuery(portalQueries.roadmaps())
  const roadmap = roadmaps.find((candidate) => candidate.id === block.roadmapId) ?? roadmaps[0]
  const columns = roadmapColumns(roadmap, block)
  const draw = !roadmap || columns.length === 0 ? emptyDraw(block, samples) : null
  if (draw === 'hide') return null
  const count = block.perColumn ?? PER_COLUMN
  const votes = shows(block, 'showVotes')
  const action = { label: intl.formatMessage(homeMessages.roadmapAll), to: '/roadmap' }
  if (draw === 'message')
    return (
      <BlockCard
        block={block}
        index={index}
        title={roadmap?.name ?? intl.formatMessage(homeMessages.roadmapTitle)}
        action={action}
      >
        <EmptyWords block={block} usual={intl.formatMessage(homeMessages.roadmapEmpty)} />
      </BlockCard>
    )
  const grid = 'grid gap-4 sm:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]'
  if (draw === 'samples')
    return (
      <BlockCard
        block={block}
        index={index}
        sample
        title={roadmap?.name ?? intl.formatMessage(homeMessages.roadmapTitle)}
        action={action}
      >
        <div className={grid}>
          {SAMPLE_COLUMNS.map((column, at) => (
            <div key={column.id} className="min-w-0 space-y-2">
              <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                <StatusDot colour={column.color} />
                {column.name}
              </h3>
              <ul className="space-y-1.5">
                {SAMPLE_POSTS.slice(at, at + count).map((post) => (
                  <li key={post.id}>
                    <RoadmapPost title={post.title} votes={votes ? post.voteCount : null} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </BlockCard>
    )
  return (
    <BlockCard block={block} index={index} title={roadmap!.name} action={action}>
      <div className={grid}>
        {columns.map((column) => (
          <div key={column.id} className="min-w-0 space-y-2">
            <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <StatusDot colour={column.color} />
              {column.name}
            </h3>
            <RoadmapColumnPosts
              roadmapId={roadmap!.id}
              statusId={column.statusId ?? undefined}
              count={count}
              votes={votes}
            />
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
  const samples = usePreviewSamples()
  const { data } = useSuspenseInfiniteQuery(publicChangelogQueries.list())
  const found = data.pages.flatMap((page) => page.items).slice(0, block.count)
  const draw = found.length === 0 ? emptyDraw(block, samples) : null
  if (draw === 'hide') return null
  const sample = draw === 'samples'
  const entries = sample ? sampleEntries(Date.now()).slice(0, block.count) : found
  const date = shows(block, 'showDate')
  const summary = shows(block, 'showSummary')
  return (
    <BlockCard
      block={block}
      index={index}
      sample={sample}
      title={intl.formatMessage(homeMessages.updatesTitle)}
      action={{ label: intl.formatMessage(homeMessages.updatesAll), to: '/changelog' }}
    >
      {draw === 'message' ? (
        <EmptyWords block={block} usual={intl.formatMessage(homeMessages.updatesEmpty)} />
      ) : (
        <ul className="space-y-3">
          {entries.map((entry) => (
            <li key={entry.id} className="min-w-0">
              {sample ? (
                <span className="block font-medium text-foreground">{entry.title}</span>
              ) : (
                <Link
                  to="/changelog/$entryId"
                  params={{ entryId: entry.id }}
                  data-qb-item="entry-title"
                  className="block font-medium text-foreground hover:underline"
                >
                  {entry.title}
                </Link>
              )}
              {date && entry.publishedAt && (
                <time
                  dateTime={String(entry.publishedAt)}
                  className="text-xs text-muted-foreground"
                >
                  {intl.formatDate(entry.publishedAt, { dateStyle: 'medium' })}
                </time>
              )}
              {summary && entry.content && (
                <p className="line-clamp-2 text-sm text-muted-foreground">
                  {contentPreview(entry.content, 200)}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </BlockCard>
  )
}

/** Popular articles a Help search block lists, as it says or as it always was. */
const POPULAR = 5

function PopularArticles({ count }: { count: number }) {
  const { data: articles } = useSuspenseQuery(popularArticlesQuery())
  const shown = articles.slice(0, count)
  if (shown.length === 0) return null
  return (
    <ul className="divide-y divide-border/60">
      {shown.map((article) => (
        <li key={article.id}>
          <Link
            to={
              hcArticlePath({
                locale: DEFAULT_LOCALE,
                urlId: article.urlId,
                slug: article.slug,
              }) as '/hc'
            }
            data-qb-item="article-title"
            className="flex items-baseline justify-between gap-3 py-2 text-sm hover:underline"
          >
            <span className="min-w-0 truncate font-medium text-foreground">{article.title}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{article.categoryName}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}

function HelpSearchBlock({
  block,
  index,
}: {
  block: Extract<HomeBlock, { type: 'help_search' }>
  index: number
}) {
  const intl = useIntl()
  const askAiEnabled = useRouteContext({
    from: '__root__',
    select: (context) => !!context.settings?.featureFlags?.helpCenter,
  })
  const count = block.popular ?? POPULAR
  return (
    <BlockCard
      block={block}
      index={index}
      title={intl.formatMessage(homeMessages.helpSearchTitle)}
      action={{ label: intl.formatMessage(homeMessages.helpAll), to: '/hc' }}
    >
      <HelpCenterHeroSearch askAiEnabled={askAiEnabled} size="block" />
      {count > 0 && <PopularArticles count={count} />}
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
  const samples = usePreviewSamples()
  const { data: categories } = useSuspenseQuery(publicHelpCenterQueries.categories())
  const chosen = chosenTopics(categories, block.categoryIds)
  const draw = chosen.length === 0 ? emptyDraw(block, samples) : null
  if (draw === 'hide') return null
  const counts = shows(block, 'showCounts')
  const articles = block.topArticles ?? 0
  const layout = block.layout ?? 'cards'
  return (
    <BlockCard
      block={block}
      index={index}
      sample={draw === 'samples'}
      title={intl.formatMessage(homeMessages.helpTopicsTitle)}
      action={{ label: intl.formatMessage(homeMessages.helpAll), to: '/hc' }}
    >
      {draw === 'message' ? (
        <EmptyWords block={block} usual={intl.formatMessage(homeMessages.helpTopicsEmpty)} />
      ) : draw === 'samples' ? (
        articles > 0 ? (
          <HelpCenterTopicsWithArticles
            topics={SAMPLE_TOPICS}
            counts={counts}
            articles={articles}
            sample
            fit
          />
        ) : (
          <HelpCenterCategoryGrid
            categories={SAMPLE_TOPICS.map((topic, at) => ({
              ...topic,
              urlId: at + 1,
              slug: topic.id,
              icon: null,
              parentId: null,
            }))}
            layout={layout}
            counts={counts}
            linked={false}
            fit
          />
        )
      ) : articles > 0 ? (
        <HelpCenterTopicsWithArticles topics={chosen} counts={counts} articles={articles} fit />
      ) : (
        <HelpCenterCategoryGrid
          categories={chosen}
          {...(block.layout ? { layout } : {})}
          {...(counts ? {} : { counts })}
          fit
        />
      )}
    </BlockCard>
  )
}

function StatusBlock({
  block,
  index,
}: {
  block: Extract<HomeBlock, { type: 'status' }>
  index: number
}) {
  const intl = useIntl()
  const samples = usePreviewSamples()
  const { data } = useSuspenseQuery(publicStatusPageQueries.get())
  // With no components, its overall status would say all is well with nothing behind it.
  const draw = statusHasComponents(data.snapshot) ? null : emptyDraw(block, samples)
  if (draw === 'hide') return null
  const { status, activeIncidentCount } = data.snapshot.topLevel
  const shown = draw === 'samples' ? 'operational' : status
  const style = COMPONENT_STATUS_STYLE[shown]
  return (
    <BlockCard
      block={block}
      index={index}
      sample={draw === 'samples'}
      title={intl.formatMessage(homeMessages.statusTitle)}
      action={{ label: intl.formatMessage(homeMessages.statusAll), to: '/status' }}
    >
      {draw === 'message' ? (
        <EmptyWords block={block} usual={intl.formatMessage(homeMessages.statusEmpty)} />
      ) : (
        <p
          data-qb-live={draw ? undefined : 'status'}
          className={cn('flex items-center gap-2 font-medium', style.text)}
        >
          <span aria-hidden="true" className={cn('size-2.5 rounded-full', style.dot)} />
          {intl.formatMessage(HERO_HEADLINE[shown])}
        </p>
      )}
      {!draw && shows(block, 'showIncidents') && activeIncidentCount > 0 && (
        <ul className="space-y-1 text-sm">
          {data.snapshot.activeIncidents.slice(0, 3).map((incident) => (
            <li key={incident.id}>
              <Link
                to="/status/$incidentId"
                params={{ incidentId: incident.id }}
                data-qb-item="incident-title"
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

function ContactBlock({
  block,
  index,
}: {
  block: Extract<HomeBlock, { type: 'contact' }>
  index: number
}) {
  const intl = useIntl()
  const own = useOwnWords(block.text)
  return (
    <BlockCard
      block={block}
      index={index}
      // Across most of the row, its words and its way on share a line.
      row={block.grid.w >= 10}
      title={intl.formatMessage(homeMessages.contactTitle)}
      action={{ label: intl.formatMessage(homeMessages.contactStart), to: '/support' }}
    >
      <p
        data-qb-words={block.id ? `block-${block.id}.text` : undefined}
        className="text-sm text-muted-foreground"
      >
        {own || intl.formatMessage(homeMessages.contactBody)}
      </p>
    </BlockCard>
  )
}

/** The portal's boards, each with its posts, leading to the feed on that board. */
function BoardsBlock({
  block,
  index,
}: {
  block: Extract<HomeBlock, { type: 'boards' }>
  index: number
}) {
  const intl = useIntl()
  const { data: boards } = useSuspenseQuery(portalQueries.boards())
  if (boards.length === 0) return null
  const counts = shows(block, 'showCounts')
  return (
    <BlockCard
      block={block}
      index={index}
      title={intl.formatMessage(homeMessages.boardsTitle)}
      action={{ label: intl.formatMessage(homeMessages.ideasAll), to: HOME_FEED_PATH }}
    >
      <ul className="divide-y divide-border/60">
        {boards.map((board) => (
          <li
            key={board.id}
            className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0"
          >
            <Link
              to={HOME_FEED_PATH}
              search={{ board: board.slug }}
              data-qb-item="board-name"
              className="min-w-0 truncate font-medium text-foreground hover:underline"
            >
              {board.name}
            </Link>
            {counts && (
              <span className="shrink-0 text-xs text-muted-foreground">
                {intl.formatMessage(homeMessages.boardPosts, { count: board.postCount })}
              </span>
            )}
          </li>
        ))}
      </ul>
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
  boards: 'feedback',
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
      case 'boards':
        return <BoardsBlock block={block} index={index} />
    }
  })()
  return <Suspense fallback={<BlockSkeleton block={block} index={index} />}>{body}</Suspense>
}
