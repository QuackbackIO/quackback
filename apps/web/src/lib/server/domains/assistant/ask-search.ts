/**
 * Workspace search for the team dashboard: the Ctrl+K palette and the
 * /admin/search results page. Full text only; it never needs an AI provider.
 * When the results page asks for it and an embedding provider is set up,
 * matches by meaning are merged in (workspace-semantic-search.ts).
 *
 * Every kind reads through the same visibility rule its own page uses, so a
 * result is always a record the viewer could open:
 * - posts: postViewFilter (boards and moderation state), live boards only
 * - conversations: conversationFilter (all, or assigned to me or my teams)
 * - tickets: ticketFilter (same resolution, never deleted)
 * - articles: help center visibility, the team slice for help center
 *   managers and the public slice (published, public category, segment
 *   gates) for everyone else
 * - changelog: drafts and scheduled entries only with changelog.view_draft
 *   or changelog.manage
 * - people, teammates and companies: people.view, member.view, and
 *   people.view with company.view; test customers never appear
 *
 * Ranking follows the rule in lib/shared/assistant/ask-search.ts: each query
 * returns score = titleTier + textScore, computed here in SQL so each kind's
 * own LIMIT keeps exactly its best rows, and the lists merge in one order.
 */
import type { SQL } from 'drizzle-orm'
import {
  db,
  posts,
  boards,
  helpCenterArticles,
  helpCenterCategories,
  changelogEntries,
  conversations,
  tickets,
  principal,
  user,
  companies,
  and,
  eq,
  ne,
  isNull,
  sql,
} from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import { can } from '@/lib/server/policy/authorize'
import { postViewFilter } from '@/lib/server/policy/posts'
import { conversationFilter } from '@/lib/server/policy/conversations'
import { ticketFilter } from '@/lib/server/policy/tickets'
import { notTestPrincipal } from '@/lib/server/test-data'
import { helpCenterVisibilityConditions } from '@/lib/server/domains/help-center/help-center-search.service'
import { keywordTsQuery } from '@/lib/server/domains/posts/post.search'
import { PERMISSIONS } from '@/lib/shared/permissions'
import { DEFAULT_LOCALE } from '@/lib/shared/i18n'
import { hcArticlePath } from '@/lib/shared/help-center-url'
import type { FeatureFlags } from '@/lib/shared/types/settings'
import {
  MAX_SEARCH_DEPTH,
  MAX_SEARCH_LENGTH,
  MIN_SEARCH_LENGTH,
  SEARCH_PAGE_SIZE,
  mergeSearchResults,
  searchableKinds,
  searchExcerpt,
  type SearchKind,
  type SearchPage,
  type SearchResult,
} from '@/lib/shared/assistant/ask-search'

/** What one kind's query needs: the query text, its tsquery and how many rows to keep. */
export interface KindSearch {
  text: string
  tsq: SQL | null
  depth: number
  actor: Actor
}

interface Row {
  id: string
  title: string | null
  content?: string | null
  subtitle?: string | null
  updatedAt: Date | null
  score: number
  href?: string
}

/** `like` pattern text with its wildcards taken literally. */
function likeText(text: string): string {
  return text.replace(/[\\%_]/g, (char) => `\\${char}`)
}

/**
 * titleTier for one or more title columns: 3 the same as the query, 2 starts
 * with it, 1 contains it, 0 otherwise (case ignored); the best column wins.
 */
export function titleTier(text: string, ...columns: SQL[]): SQL<number> {
  const lower = text.toLowerCase()
  const prefix = `${likeText(lower)}%`
  const contains = `%${likeText(lower)}%`
  const tiers = columns.map(
    (column) => sql`(case when lower(${column}) = ${lower} then 3
      when lower(${column}) like ${prefix} then 2
      when lower(${column}) like ${contains} then 1 else 0 end)`
  )
  return sql<number>`greatest(${sql.join(tiers, sql`, `)}, 0)`
}

/** textScore for full-text kinds: ts_rank normalised into 0 to under 1. */
function textRank(vector: SQL, tsq: SQL): SQL {
  return sql`ts_rank(${vector}, ${tsq}, 32)`
}

/** The changelog's searched text. Kept identical to listChangelogs and changelog_entries_search_idx. */
const changelogVector = sql`to_tsvector('english', coalesce(${changelogEntries.title}, '') || ' ' || coalesce(${changelogEntries.content}, ''))`

/** Who may see which posts: the post's own visibility rule, on live boards, never merged. */
export function postSearchScope(actor: Actor): SQL {
  return and(
    postViewFilter(actor),
    isNull(posts.deletedAt),
    isNull(posts.canonicalPostId),
    isNull(boards.deletedAt)
  )!
}

/** Help center managers see the team slice; everyone else what their audience may read. */
export function articleSearchScope(actor: Actor): { manager: boolean; conditions: SQL[] } {
  const manager = can(actor, PERMISSIONS.HELP_CENTER_MANAGE)
  return {
    manager,
    conditions: helpCenterVisibilityConditions(manager ? 'team' : 'public', actor).filter(
      (condition): condition is SQL => !!condition
    ),
  }
}

export function articleHref(
  manager: boolean,
  row: { id: string; urlId: number; slug: string }
): string {
  return manager
    ? `/admin/help-center?article=${encodeURIComponent(row.id)}`
    : hcArticlePath({ locale: DEFAULT_LOCALE, urlId: row.urlId, slug: row.slug })
}

/** Drafts and scheduled entries need the draft permission; published entries are public. */
export function changelogSearchScope(actor: Actor): SQL {
  const drafts =
    can(actor, PERMISSIONS.CHANGELOG_VIEW_DRAFT) || can(actor, PERMISSIONS.CHANGELOG_MANAGE)
  return and(
    isNull(changelogEntries.deletedAt),
    drafts ? undefined : sql`${changelogEntries.publishedAt} <= now()`
  )!
}

export const SEARCH_HREF: Record<Exclude<SearchKind, 'article'>, (id: string) => string> = {
  post: (id) => `/admin/feedback?post=${encodeURIComponent(id)}`,
  conversation: (id) => `/admin/inbox?i=${encodeURIComponent(id)}`,
  ticket: (id) => `/admin/inbox?i=${encodeURIComponent(id)}`,
  changelog: (id) => `/admin/changelog?entry=${encodeURIComponent(id)}`,
  person: (id) => `/admin/users?selected=${encodeURIComponent(id)}`,
  teammate: () => '/admin/settings/members',
  company: (id) => `/admin/users?lifecycle=companies&company=${encodeURIComponent(id)}`,
}

async function searchPosts({ text, tsq, depth, actor }: KindSearch): Promise<Row[]> {
  if (!tsq) return []
  const score = sql<number>`${titleTier(text, sql`${posts.title}`)} + ${textRank(sql`${posts.searchVector}`, tsq)}`
  return db
    .select({
      id: posts.id,
      title: posts.title,
      content: sql<string>`left(${posts.content}, 2000)`,
      updatedAt: posts.updatedAt,
      score,
    })
    .from(posts)
    .innerJoin(boards, eq(boards.id, posts.boardId))
    .where(and(postSearchScope(actor), sql`${posts.searchVector} @@ ${tsq}`))
    .orderBy(sql`${score} desc`, sql`${posts.updatedAt} desc`, posts.id)
    .limit(depth)
}

async function searchArticles({ text, tsq, depth, actor }: KindSearch): Promise<Row[]> {
  if (!tsq) return []
  const { manager, conditions } = articleSearchScope(actor)
  const score = sql<number>`${titleTier(text, sql`${helpCenterArticles.title}`)} + ${textRank(sql`${helpCenterArticles.searchVector}`, tsq)}`
  const rows = await db
    .select({
      id: helpCenterArticles.id,
      urlId: helpCenterArticles.urlId,
      slug: helpCenterArticles.slug,
      title: helpCenterArticles.title,
      content: sql<string>`left(${helpCenterArticles.content}, 2000)`,
      updatedAt: helpCenterArticles.updatedAt,
      score,
    })
    .from(helpCenterArticles)
    .innerJoin(helpCenterCategories, eq(helpCenterCategories.id, helpCenterArticles.categoryId))
    .where(and(...conditions, sql`${helpCenterArticles.searchVector} @@ ${tsq}`))
    .orderBy(sql`${score} desc`, sql`${helpCenterArticles.updatedAt} desc`, helpCenterArticles.id)
    .limit(depth)
  return rows.map((row) => ({ ...row, href: articleHref(manager, row) }))
}

async function searchChangelog({ text, tsq, depth, actor }: KindSearch): Promise<Row[]> {
  if (!tsq) return []
  const score = sql<number>`${titleTier(text, sql`${changelogEntries.title}`)} + ${textRank(changelogVector, tsq)}`
  return db
    .select({
      id: changelogEntries.id,
      title: changelogEntries.title,
      content: sql<string>`left(${changelogEntries.content}, 2000)`,
      updatedAt: changelogEntries.updatedAt,
      score,
    })
    .from(changelogEntries)
    .where(and(changelogSearchScope(actor), sql`${changelogVector} @@ ${tsq}`))
    .orderBy(sql`${score} desc`, sql`${changelogEntries.updatedAt} desc`, changelogEntries.id)
    .limit(depth)
}

/**
 * Records found through their messages, ranked in one pass over the message
 * index whatever the number of candidates: each parent's best live message
 * (internal notes too, as in the inbox), unioned with the parent's own title
 * match, as `search_match(id, rank, message_id)`. `parent` is the message's
 * parent id; `titles` selects (id, rank) of parents whose title matches.
 */
function messageAndTitleMatches(parent: SQL, messages: SQL, titles: SQL, tsq: SQL): SQL {
  const rank = sql`ts_rank(cm.search_vector, ${tsq}, 32)`
  return sql`(select id, max(rank) as rank,
      (array_agg(message_id) filter (where message_id is not null))[1] as message_id
    from (
      (select distinct on (${parent}) ${parent} as id, ${rank} as rank, cm.id as message_id
      from ${messages}
      where cm.deleted_at is null and cm.search_vector @@ ${tsq} and ${parent} is not null
      order by ${parent}, ${rank} desc, cm.created_at desc)
      union all
      select title_match.id, title_match.rank, null::uuid from (${titles}) title_match
    ) found
    group by id) search_match`
}

/** The matched message's text, read by primary key for the rows on the page only. */
const matchedMessage = sql<string | null>`(select left(matched.content, 2000)
  from conversation_messages matched where matched.id = search_match.message_id)`

/** Conversations whose subject or any live message matches. */
async function searchConversations({ text, tsq, depth, actor }: KindSearch): Promise<Row[]> {
  if (!tsq) return []
  const matches = messageAndTitleMatches(
    sql`cm.conversation_id`,
    sql`conversation_messages cm`,
    sql`select subject_row.id, ts_rank(to_tsvector('english', coalesce(subject_row.subject, '')), ${tsq}, 32) as rank
      from conversations subject_row
      where to_tsvector('english', coalesce(subject_row.subject, '')) @@ ${tsq}`,
    tsq
  )
  const score = sql<number>`${titleTier(text, sql`${conversations.subject}`)} + search_match.rank`
  return db
    .select({
      id: conversations.id,
      title: sql<string | null>`coalesce(${conversations.subject}, ${principal.displayName})`,
      content: matchedMessage,
      updatedAt: conversations.updatedAt,
      score,
    })
    .from(conversations)
    .innerJoin(matches, sql`search_match.id = ${conversations.id}`)
    .leftJoin(principal, eq(principal.id, conversations.visitorPrincipalId))
    .where(conversationFilter(actor))
    .orderBy(sql`${score} desc`, sql`${conversations.updatedAt} desc`, conversations.id)
    .limit(depth)
}

/**
 * Tickets whose title or any message on either side of the pair matches: a
 * message hangs off the ticket, or off its paired customer conversation (as
 * in ticketFtsMatch, but found from the indexes rather than ticket by ticket).
 */
async function searchTickets({ text, tsq, depth, actor }: KindSearch): Promise<Row[]> {
  if (!tsq) return []
  const matches = messageAndTitleMatches(
    sql`coalesce(cm.ticket_id, tc.ticket_id)`,
    sql`conversation_messages cm left join ticket_conversations tc
      on tc.conversation_id = cm.conversation_id and tc.ticket_type = 'customer'`,
    sql`select title_row.id, ts_rank(to_tsvector('english', title_row.title), ${tsq}, 32) as rank
      from tickets title_row
      where to_tsvector('english', title_row.title) @@ ${tsq}`,
    tsq
  )
  const score = sql<number>`${titleTier(text, sql`${tickets.title}`)} + search_match.rank`
  return db
    .select({
      id: tickets.id,
      title: tickets.title,
      content: matchedMessage,
      updatedAt: tickets.updatedAt,
      score,
    })
    .from(tickets)
    .innerJoin(matches, sql`search_match.id = ${tickets.id}`)
    .where(ticketFilter(actor))
    .orderBy(sql`${score} desc`, sql`${tickets.updatedAt} desc`, tickets.id)
    .limit(depth)
}

/**
 * Names, emails and domains match anywhere inside, served by trigram
 * indexes. A trigram index cannot narrow a pattern shorter than three
 * characters, so shorter queries skip these kinds rather than scan them.
 */
const MIN_NAME_SEARCH_LENGTH = 3

/**
 * Identified people by name, display name or email: contacts (portal users)
 * or teammates. Candidates come from the trigram indexes on each column.
 */
function searchPrincipals(team: boolean) {
  return async ({ text, depth }: KindSearch): Promise<Row[]> => {
    if (text.length < MIN_NAME_SEARCH_LENGTH) return []
    const contains = `%${likeText(text)}%`
    const name = sql`coalesce(${principal.displayName}, ${user.name})`
    const score = sql<number>`${titleTier(text, sql`${principal.displayName}`, sql`${user.name}`, sql`${user.email}`)}`
    return db
      .select({
        id: principal.id,
        title: sql<string | null>`coalesce(nullif(${name}, ''), ${user.email})`,
        subtitle: user.email,
        updatedAt: user.updatedAt,
        score,
      })
      .from(principal)
      .innerJoin(user, eq(user.id, principal.userId))
      .where(
        and(
          eq(principal.type, 'user'),
          team ? ne(principal.role, 'user') : eq(principal.role, 'user'),
          notTestPrincipal(principal.id),
          sql`${principal.id} in (
            select name_match.id from principal name_match
            where name_match.display_name ilike ${contains}
            union
            select user_match_principal.id from "user" user_match
            inner join principal user_match_principal on user_match_principal.user_id = user_match.id
            where user_match.name ilike ${contains} or user_match.email ilike ${contains}
          )`
        )
      )
      .orderBy(sql`${score} desc`, sql`${user.updatedAt} desc`, principal.id)
      .limit(depth)
  }
}

async function searchCompanies({ text, depth }: KindSearch): Promise<Row[]> {
  if (text.length < MIN_NAME_SEARCH_LENGTH) return []
  const contains = `%${likeText(text)}%`
  const score = sql<number>`${titleTier(text, sql`${companies.name}`, sql`${companies.domain}`)}`
  return db
    .select({
      id: companies.id,
      title: companies.name,
      subtitle: companies.domain,
      updatedAt: companies.updatedAt,
      score,
    })
    .from(companies)
    .where(sql`(${companies.name} ilike ${contains} or ${companies.domain} ilike ${contains})`)
    .orderBy(sql`${score} desc`, sql`${companies.updatedAt} desc`, companies.id)
    .limit(depth)
}

const SEARCHERS: Record<SearchKind, (search: KindSearch) => Promise<Row[]>> = {
  post: searchPosts,
  conversation: searchConversations,
  ticket: searchTickets,
  article: searchArticles,
  changelog: searchChangelog,
  person: searchPrincipals(false),
  teammate: searchPrincipals(true),
  company: searchCompanies,
}

export function toSearchResult(kind: SearchKind, row: Row, text: string): SearchResult {
  return {
    id: row.id,
    kind,
    title: row.title ?? '',
    href: row.href ?? SEARCH_HREF[kind as Exclude<SearchKind, 'article'>](row.id),
    ...(row.content ? { excerpt: searchExcerpt(row.content, text) } : {}),
    ...(row.subtitle ? { subtitle: row.subtitle } : {}),
    ...(row.updatedAt ? { updatedAt: new Date(row.updatedAt).toISOString() } : {}),
    score: Number(row.score),
  }
}

export interface WorkspaceSearchOptions {
  kind?: SearchKind
  offset?: number
  limit?: number
  /** Merge in matches by meaning when an embedding provider is set up. */
  semantic?: boolean
  signal?: AbortSignal
}

/** Only teammates search the workspace; portal users never reach this. */
function isTeamViewer(actor: Actor): boolean {
  return !!actor.principalId && (actor.role === 'admin' || actor.role === 'member')
}

/** The kinds this viewer may search, narrowed to one when asked. */
export function kindsFor(
  actor: Actor,
  flags: Partial<FeatureFlags>,
  kind?: SearchKind
): SearchKind[] {
  if (!isTeamViewer(actor)) return []
  return searchableKinds((permission) => can(actor, permission), flags).filter(
    (allowed) => !kind || allowed === kind
  )
}

/**
 * One page of the viewer's records matching a query, every kind in one
 * order. Each kind keeps its best offset + limit + 1 rows, which is all the
 * merged list needs to know this page and whether another follows.
 */
export async function searchWorkspace(
  query: string,
  actor: Actor,
  flags: Partial<FeatureFlags>,
  options: WorkspaceSearchOptions = {}
): Promise<SearchPage> {
  const text = query.trim().slice(0, MAX_SEARCH_LENGTH)
  const kinds = kindsFor(actor, flags, options.kind)
  const offset = Math.max(0, Math.min(options.offset ?? 0, MAX_SEARCH_DEPTH))
  const limit = Math.max(1, Math.min(options.limit ?? SEARCH_PAGE_SIZE, 50))
  if (text.length < MIN_SEARCH_LENGTH || kinds.length === 0 || offset >= MAX_SEARCH_DEPTH)
    return { results: [], hasMore: false }
  const end = Math.min(offset + limit, MAX_SEARCH_DEPTH)
  const search: KindSearch = { text, tsq: keywordTsQuery(text), depth: end + 1, actor }
  const semantic = options.semantic
    ? import('./workspace-semantic-search').then(({ searchWorkspaceSemantically }) =>
        searchWorkspaceSemantically(text, actor, kinds, end + 1, options.signal)
      )
    : Promise.resolve<SearchResult[]>([])
  const [keyword, meaning] = await Promise.all([
    Promise.all(
      kinds.map((kind) =>
        SEARCHERS[kind](search).then((rows) => rows.map((row) => toSearchResult(kind, row, text)))
      )
    ),
    semantic,
  ])
  const merged = mergeSearchResults(...keyword, meaning)
  return {
    results: merged.slice(offset, end),
    hasMore: merged.length > end && end < MAX_SEARCH_DEPTH,
  }
}
