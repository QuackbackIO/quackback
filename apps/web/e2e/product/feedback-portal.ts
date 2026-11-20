/**
 * Helpers for the customer side of feedback (tests/feedback/portal-*.spec.ts):
 * boards and posts a test owns, customers signed in by minted sessions, and
 * the portal's own server functions called the way the browser calls them.
 *
 * Everything a test creates carries its marker, and every feed assertion is
 * scoped to the test's own board (`?board=<slug>`, `boardSlug`) or a search
 * word only that test uses, so tests never read each other's rows.
 *
 *   const board = await createBoard(marker)
 *   const post = await seedPost(board, { title: `${marker} first` })
 *   const ann = await portalCustomer(browser, marker)
 *   const res = await fbFn(ann.request, 'publicPosts', 'toggleVoteFn', { postId: post.id })
 */
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { fromUuid, generateId, toUuid } from '@quackback/ids'
import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
  type PlaywrightWorkerArgs,
} from '@playwright/test'
import { createSupportApiKey } from '../utils/db-helpers'
import { supportDb } from '../support/db'
import { supportEnv } from '../support/env'
import { CLIENT_IP_HEADER } from '../support/webhooks'
import {
  callServerFn,
  mintCustomer,
  mintSessionToken,
  type MintedCustomer,
  type ServerFnResult,
} from '../support/widget-portal'

// ---------------------------------------------------------------------------
// Server functions
// ---------------------------------------------------------------------------

/** Source files of the server functions the customer feedback surfaces call. */
export const FB_FILES = {
  publicPosts: 'src/lib/server/functions/public-posts.ts',
  portal: 'src/lib/server/functions/portal.ts',
  comments: 'src/lib/server/functions/comments.ts',
  subscriptions: 'src/lib/server/functions/subscriptions.ts',
  notifications: 'src/lib/server/functions/notifications.ts',
  publicProfile: 'src/lib/server/functions/public-profile.ts',
  widgetPosts: 'src/lib/server/functions/widget/posts.ts',
  widgetComments: 'src/lib/server/functions/widget/comments.ts',
  widgetUser: 'src/lib/server/functions/widget/user.ts',
} as const
export type FbFile = keyof typeof FB_FILES

/** Server functions declared with method GET (everything else is POST). */
const GET_FNS = new Set([
  'listPublicPostsFn',
  'getPostPermissionsFn',
  'getVotedPostsFn',
  'getVoteSidebarDataFn',
  'findSimilarPostsFn',
  'getCommentPermissionsFn',
  'canPinCommentFn',
  'getNotificationsFn',
  'getUnreadCountFn',
  'getPublicUserProfileFn',
  'getProfileTeamContextFn',
  'fetchPortalData',
  'fetchPublicBoards',
  'fetchPublicBoardBySlug',
  'fetchPublicPostDetail',
  'fetchPublicPosts',
  'fetchPublicStatuses',
  'fetchPublicTags',
  'fetchSubscriptionStatus',
  'getCommentsSectionDataFn',
  'fetchBoardCapabilitiesFn',
  'previewUnsubscribeTokenFn',
])

/**
 * Call a feedback server function by file and export name, with the cookies
 * of `request` (or a widget `bearer`). The client address header is set per
 * call when `ip` is given, so anonymous rate limits key on the test's own
 * address.
 */
export function fbFn<T = unknown>(
  request: APIRequestContext,
  file: FbFile,
  name: string,
  data?: unknown,
  opts: { bearer?: string; ip?: string; method?: 'GET' | 'POST' } = {}
): Promise<ServerFnResult<T>> {
  return callServerFn<T>(request, FB_FILES[file], name, {
    method: opts.method ?? (GET_FNS.has(name) || /^widget(Get|List)/.test(name) ? 'GET' : 'POST'),
    data,
    bearer: opts.bearer,
    headers: opts.ip ? { [CLIENT_IP_HEADER]: opts.ip } : undefined,
  })
}

/** A private address only this marker uses (anonymous rate limits key on it). */
export function ipFor(marker: string, salt = ''): string {
  const h = createHash('sha256').update(`${marker}:${salt}`).digest()
  return `10.${h[0]}.${h[1]}.${(h[2] % 250) + 1}`
}

/** A hyphen-free word only this marker uses, for search journeys. */
export function wordFor(marker: string, salt = ''): string {
  const h = createHash('sha256').update(`${marker}:${salt}`).digest('hex')
  return `zq${h.replace(/[0-9]/g, (d) => 'abcdefghij'[Number(d)]).slice(0, 10)}`
}

// ---------------------------------------------------------------------------
// Boards, statuses, tags, posts
// ---------------------------------------------------------------------------

export type Tier = 'anonymous' | 'authenticated' | 'segments' | 'team'

export interface BoardAccessInput {
  view?: Tier
  vote?: Tier
  comment?: Tier
  submit?: Tier
  segments?: Partial<Record<'view' | 'vote' | 'comment' | 'submit', string[]>>
  moderation?: Partial<Record<'comments' | 'anonPosts' | 'signedPosts', 'inherit' | 'on' | 'off'>>
  replyPolicy?: string
}

export interface TestBoard {
  id: string
  uuid: string
  slug: string
  name: string
}

/** A board only this test uses (all tiers anonymous unless overridden). */
export async function createBoard(
  marker: string,
  opts: {
    suffix?: string
    name?: string
    access?: BoardAccessInput
    readOnly?: boolean
    customFields?: Array<{
      key: string
      label: string
      type: string
      required: boolean
      options?: string[]
    }>
  } = {}
): Promise<TestBoard> {
  const uuid = toUuid(generateId('board'))
  const slug = `${marker}${opts.suffix ? `-${opts.suffix}` : ''}`.toLowerCase().slice(0, 60)
  const name = opts.name ?? `Board ${slug}`
  const a = opts.access ?? {}
  const access = {
    view: a.view ?? 'anonymous',
    vote: a.vote ?? 'anonymous',
    submit: a.submit ?? 'anonymous',
    comment: a.comment ?? 'anonymous',
    segments: { view: [], vote: [], submit: [], comment: [], ...a.segments },
    moderation: {
      comments: 'inherit',
      anonPosts: 'inherit',
      signedPosts: 'inherit',
      ...a.moderation,
    },
    ...(a.replyPolicy ? { replyPolicy: a.replyPolicy } : {}),
  }
  const settings = opts.customFields ? { customFields: opts.customFields } : {}
  await supportDb()`INSERT INTO boards (id, slug, name, access, settings, read_only)
    VALUES (${uuid}, ${slug}, ${name}, ${supportDb().json(access)}, ${supportDb().json(settings)},
            ${opts.readOnly ?? false})`
  return { id: fromUuid('board', uuid), uuid, slug, name }
}

/** Patch a board's access JSON (merged at the top level). */
export async function setBoardAccess(board: TestBoard, access: BoardAccessInput): Promise<void> {
  await supportDb()`UPDATE boards SET access = access || ${supportDb().json(access as never)}
    WHERE id = ${board.uuid}`
}

const statusCache = new Map<string, { uuid: string; id: string; name: string }>()
/** A built-in status by slug (open, under_review, planned, in_progress, complete, closed). */
export async function status(slug: string): Promise<{ uuid: string; id: string; name: string }> {
  const hit = statusCache.get(slug)
  if (hit) return hit
  const [row] = await supportDb()`SELECT id, name FROM post_statuses WHERE slug = ${slug}`
  if (!row) throw new Error(`no status ${slug}`)
  const value = {
    uuid: row.id as string,
    id: fromUuid('post_status', row.id as string),
    name: row.name as string,
  }
  statusCache.set(slug, value)
  return value
}

/** A tag (public unless `isPublic` is false). */
export async function createTag(
  name: string,
  isPublic = true
): Promise<{ uuid: string; id: string; name: string }> {
  const uuid = toUuid(generateId('post_tag'))
  await supportDb()`INSERT INTO post_tags (id, name, is_public) VALUES (${uuid}, ${name}, ${isPublic})`
  return { uuid, id: fromUuid('post_tag', uuid), name }
}

export interface TestPost {
  id: string
  uuid: string
  title: string
  board: TestBoard
}

/** A principal to author seeded posts: a fresh customer unless given. */
let authorCache: MintedCustomer | null = null
async function defaultAuthor(): Promise<MintedCustomer> {
  authorCache ??= await mintCustomer({
    email: `fbp-author-${randomBytes(4).toString('hex')}@customers.example`,
    name: 'Fern Author',
  })
  return authorCache
}

/**
 * A post seeded straight into the database (a precondition, not the action
 * under test). Defaults: status Open, published, 0 votes, now.
 */
export async function seedPost(
  board: TestBoard,
  opts: {
    title: string
    content?: string
    authorPrincipalUuid?: string
    statusSlug?: string | null
    voteCount?: number
    commentCount?: number
    createdAt?: Date
    moderationState?: 'published' | 'pending' | 'rejected'
    pinnedAt?: Date | null
    deletedAt?: Date | null
    tagUuids?: string[]
    eta?: Date | null
  }
): Promise<TestPost> {
  const uuid = toUuid(generateId('post'))
  const author = opts.authorPrincipalUuid ?? (await defaultAuthor()).principalUuid
  const statusUuid =
    opts.statusSlug === null ? null : (await status(opts.statusSlug ?? 'open')).uuid
  const content = opts.content ?? `Details for ${opts.title}`
  const created = opts.createdAt ?? new Date()
  await supportDb()`INSERT INTO posts
      (id, board_id, title, content, principal_id, status_id, vote_count, comment_count,
       moderation_state, pinned_at, deleted_at, eta, created_at, updated_at)
    VALUES (${uuid}, ${board.uuid}, ${opts.title}, ${content}, ${author}, ${statusUuid},
            ${opts.voteCount ?? 0}, ${opts.commentCount ?? 0}, ${opts.moderationState ?? 'published'},
            ${opts.pinnedAt ?? null}, ${opts.deletedAt ?? null}, ${opts.eta ?? null},
            ${created}, ${created})`
  for (const tag of opts.tagUuids ?? []) {
    await supportDb()`INSERT INTO post_tag_assignments (post_id, tag_id) VALUES (${uuid}, ${tag})`
  }
  return { id: fromUuid('post', uuid), uuid, title: opts.title, board }
}

/** Seed `count` votes from fresh voters (rows only; vote_count is set to match). */
export async function seedVotes(post: TestPost, principalUuids: string[]): Promise<void> {
  for (const p of principalUuids) {
    await supportDb()`INSERT INTO post_votes (id, post_id, principal_id)
      VALUES (${toUuid(generateId('post_vote'))}, ${post.uuid}, ${p})`
  }
  await supportDb()`UPDATE posts SET vote_count = (SELECT count(*) FROM post_votes WHERE post_id = ${post.uuid})
    WHERE id = ${post.uuid}`
}

/** A seeded comment (precondition). */
export async function seedComment(
  post: TestPost,
  opts: {
    content: string
    principalUuid: string
    parentUuid?: string
    isTeamMember?: boolean
    isPrivate?: boolean
    moderationState?: 'published' | 'pending' | 'rejected'
    createdAt?: Date
    deletedAt?: Date | null
  }
): Promise<{ id: string; uuid: string }> {
  const uuid = toUuid(generateId('post_comment'))
  await supportDb()`INSERT INTO post_comments
      (id, post_id, parent_id, principal_id, content, is_team_member, is_private, moderation_state,
       created_at, deleted_at)
    VALUES (${uuid}, ${post.uuid}, ${opts.parentUuid ?? null}, ${opts.principalUuid}, ${opts.content},
            ${opts.isTeamMember ?? false}, ${opts.isPrivate ?? false},
            ${opts.moderationState ?? 'published'}, ${opts.createdAt ?? new Date()},
            ${opts.deletedAt ?? null})`
  if (!opts.isPrivate && (opts.moderationState ?? 'published') === 'published' && !opts.deletedAt) {
    await supportDb()`UPDATE posts SET comment_count = comment_count + 1 WHERE id = ${post.uuid}`
  }
  return { id: fromUuid('post_comment', uuid), uuid }
}

/** The post row. */
export async function postRow(uuid: string): Promise<Record<string, unknown>> {
  const [row] = await supportDb()`SELECT * FROM posts WHERE id = ${uuid}`
  if (!row) throw new Error(`no post ${uuid}`)
  return row
}

/** The newest post on a board with this title (or null). */
export async function postByTitle(
  board: TestBoard,
  title: string
): Promise<Record<string, unknown> | null> {
  const [row] =
    await supportDb()`SELECT * FROM posts WHERE board_id = ${board.uuid} AND title = ${title}
    ORDER BY created_at DESC LIMIT 1`
  return row ?? null
}

/** The public post URL. */
export function postPath(post: Pick<TestPost, 'id'> & { board: Pick<TestBoard, 'slug'> }): string {
  return `/b/${post.board.slug}/posts/${post.id}`
}

// ---------------------------------------------------------------------------
// Customers
// ---------------------------------------------------------------------------

export interface PortalCustomer extends MintedCustomer {
  context: BrowserContext
  page: Page
  /** Cookie-carrying request context (shares the browser context's cookies). */
  request: APIRequestContext
  ip: string
}

/** A browser context with its own client address, signed in with `token` (or none). */
export async function contextFor(
  browser: Browser,
  ip: string,
  token?: string
): Promise<BrowserContext> {
  const env = supportEnv()
  const context = await browser.newContext({
    baseURL: env.baseUrl,
    viewport: { width: 1600, height: 1000 },
    extraHTTPHeaders: { [CLIENT_IP_HEADER]: ip },
  })
  if (token) {
    const signature = createHmac('sha256', env.app.SECRET_KEY).update(token).digest('base64')
    await context.addCookies([
      {
        name: 'better-auth.session_token',
        value: encodeURIComponent(`${token}.${signature}`),
        domain: new URL(env.baseUrl).hostname,
        path: '/',
        httpOnly: true,
        secure: false,
      },
    ])
  }
  return context
}

/**
 * A fresh customer (or anonymous visitor with `anonymous`) signed in to the
 * portal by a minted session, in a context with its own client address.
 */
export async function portalCustomer(
  browser: Browser,
  marker: string,
  opts: { suffix?: string; name?: string; anonymous?: boolean; email?: string } = {}
): Promise<PortalCustomer> {
  const suffix = opts.suffix ?? randomBytes(3).toString('hex')
  const customer = await mintCustomer({
    email: opts.anonymous ? undefined : (opts.email ?? `${marker}-${suffix}@customers.example`),
    name: opts.name,
    anonymous: opts.anonymous,
  })
  const ip = ipFor(marker, suffix)
  const token = await mintSessionToken(customer.userUuid)
  const context = await contextFor(browser, ip, token)
  const page = await context.newPage()
  return { ...customer, context, page, request: context.request, ip }
}

/** A signed-out visitor's context with its own client address. */
export async function visitor(
  browser: Browser,
  marker: string,
  salt = 'visitor'
): Promise<{ context: BrowserContext; page: Page; request: APIRequestContext; ip: string }> {
  const ip = ipFor(marker, salt)
  const context = await contextFor(browser, ip)
  const page = await context.newPage()
  return { context, page, request: context.request, ip }
}

/** A context signed in as a seeded support person, with its own client address. */
export async function personContext(
  browser: Browser,
  userUuid: string,
  marker: string
): Promise<{ context: BrowserContext; page: Page; request: APIRequestContext }> {
  const token = await mintSessionToken(userUuid)
  const context = await contextFor(browser, ipFor(marker, `person-${userUuid}`), token)
  return { context, page: await context.newPage(), request: context.request }
}

/** The raw uuid of a TypeID. */
export function uuid(typeId: string): string {
  return toUuid(typeId as never)
}

export { randomUUID }

// ---------------------------------------------------------------------------
// Team actions (REST, as the suite admin) and audit/event reads
// ---------------------------------------------------------------------------

let adminKey: string | null = null
/** A REST context with the suite admin's personal key and its own client address. */
export async function adminRest(
  playwright: PlaywrightWorkerArgs['playwright'],
  marker: string
): Promise<APIRequestContext> {
  adminKey ??= createSupportApiKey('e2e-support-admin@example.com', 'personal')
  return playwright.request.newContext({
    baseURL: supportEnv().baseUrl,
    extraHTTPHeaders: {
      authorization: `Bearer ${adminKey}`,
      [CLIENT_IP_HEADER]: ipFor(marker, 'admin-rest'),
      connection: 'close',
    },
  })
}

/** POST to the REST API and return the JSON body (throws on a non-2xx). */
export async function restPost<T = Record<string, unknown>>(
  api: APIRequestContext,
  path: string,
  data: unknown = {},
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE' = 'POST'
): Promise<T> {
  const res = await api.fetch(`/api/v1${path}`, { method, data })
  const text = await res.text()
  if (!res.ok())
    throw new Error(`${method} ${path} answered ${res.status()}: ${text.slice(0, 300)}`)
  return (text ? JSON.parse(text) : {}) as T
}

/** Audit rows (`events`-style activity) for a post: post_activity types. */
export async function postActivityTypes(postUuid: string): Promise<string[]> {
  const rows = await supportDb()`SELECT type FROM post_activity WHERE post_id = ${postUuid}
    ORDER BY created_at`
  return rows.map((r) => r.type as string)
}

// ---------------------------------------------------------------------------
// Portal UI
// ---------------------------------------------------------------------------

/** The composer's title box. */
export function titleBox(page: Page) {
  return page.getByRole('textbox', { name: 'Feedback title' })
}

/**
 * Open the composer once the page has hydrated (a focus before hydration
 * lands on inert server HTML, and text typed then is dropped), then type the
 * title. The "Posting to" line appears only when React expands the composer.
 */
export async function startPost(page: Page, title: string): Promise<void> {
  const box = titleBox(page)
  await expect(async () => {
    // A box that kept focus after Escape needs a fresh focus to expand.
    await box.blur()
    await box.click()
    await expect(page.getByLabel(/^Posting to/)).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 20_000 })
  await box.fill(title)
  await expect(box).toHaveValue(title)
}

/**
 * Wait until the feed page has hydrated, by opening and closing the composer
 * (it expands only once React runs). For a control whose click must land
 * exactly once, such as a vote that a second click would undo.
 */
export async function waitForHydration(page: Page): Promise<void> {
  await startPost(page, '')
  await titleBox(page).press('Escape')
  await expect(page.getByLabel(/^Posting to/)).toBeHidden()
}

/** Type into the composer's details editor. */
export async function typeDetails(page: Page, text: string): Promise<void> {
  const details = page.locator('.ProseMirror[contenteditable="true"]').first()
  await details.click()
  await details.pressSequentially(text)
}

/** The sonner toast with this text. */
export function toastWith(page: Page, text: string | RegExp) {
  return page.locator('[data-sonner-toast]').filter({ hasText: text })
}

/** The feed card for a post title. */
export function cardFor(page: Page, title: string) {
  return page.locator('.post-card').filter({ hasText: title })
}

/**
 * Click a server-rendered control until `done` passes: a click before
 * hydration lands on inert HTML.
 */
export async function clickUntil(
  target: Locator,
  done: () => Promise<void>,
  timeout = 20_000
): Promise<void> {
  await expect(async () => {
    await target.click()
    await done()
  }).toPass({ timeout })
}
