/**
 * Helpers for the team-side feedback journeys (FBA-*), e2e/tests/feedback/admin-*.
 *
 * Seeding goes through the product's own server functions as the admin (a
 * board, a post, a tag), so the rows look exactly like the ones a person
 * makes; the action under test is then driven through the screen or the
 * server function the journey names. Every name carries the test's marker.
 *
 *   const api = await personApi(playwright, 'admin')
 *   const board = await makeBoard(api, marker)
 *   const post = await makePost(api, { boardId: board.id, title: `${marker} idea` })
 *   const admin = await asPerson('admin')
 *   await openPost(admin, post.id)
 *
 * Area-specific helpers live in their own files next to this one
 * (feedback-admin-*.ts), so the three feedback-admin PRs never edit the same
 * file.
 */
import { expect, type APIRequestContext, type Browser, type Page } from '@playwright/test'
import { fromUuid, toUuid } from '@quackback/ids'
import { callServerFn } from '../support/server-fns'
import { supportDb } from '../support/db'
import { mintCustomer, portalContext, type MintedCustomer } from '../support/widget-portal'

export interface MadeBoard {
  id: string
  name: string
  slug: string
}

export interface MadePost {
  id: string
  title: string
  boardId: string
  statusId: string | null
}

export interface MadeTag {
  id: string
  name: string
}

/** Throw with the server's answer when a seeding call fails. */
function must<T>(res: { ok: boolean; data: T; raw: string }, what: string): T {
  if (!res.ok) throw new Error(`${what} failed: ${res.raw.slice(0, 400)}`)
  return res.data
}

/** A board only this test uses. `preset: 'private'` makes it team-only. */
export async function makeBoard(
  api: APIRequestContext,
  marker: string,
  opts: { name?: string; description?: string; preset?: 'public' | 'private' } = {}
): Promise<MadeBoard> {
  const res = await callServerFn<MadeBoard>(api, 'createBoardFn', {
    name: opts.name ?? `Board ${marker}`.slice(0, 100),
    description: opts.description,
    preset: opts.preset ?? 'public',
  })
  const board = must(res, 'createBoardFn')
  return { id: board.id, name: board.name, slug: board.slug }
}

/** A post created by whoever `api` is signed in as (a teammate), via createPostFn. */
export async function makePost(
  api: APIRequestContext,
  input: {
    boardId: string
    title: string
    content?: string
    statusId?: string
    tagIds?: string[]
    authorPrincipalId?: string
  }
): Promise<MadePost> {
  const res = await callServerFn<MadePost>(api, 'createPostFn', input)
  const post = must(res, 'createPostFn')
  return { id: post.id, title: post.title, boardId: post.boardId, statusId: post.statusId }
}

/** A tag only this test uses. */
export async function makeTag(
  api: APIRequestContext,
  name: string,
  opts: { color?: string; description?: string; aiPrompt?: string; isPublic?: boolean } = {}
): Promise<MadeTag> {
  const res = await callServerFn<MadeTag>(api, 'createPostTagFn', {
    name,
    color: opts.color ?? '#6b7280',
    ...opts,
  })
  const tag = must(res, 'createPostTagFn')
  return { id: tag.id, name: tag.name }
}

export interface PortalCustomer extends MintedCustomer {
  /** Requests signed in to the portal as this customer (for callServerFn). */
  api: APIRequestContext
  /** Close the customer's browser context. */
  close: () => Promise<void>
}

/** A fresh identified customer with a portal session. Close it when done. */
export async function portalCustomer(
  browser: Browser,
  marker: string,
  opts: { name?: string; email?: string } = {}
): Promise<PortalCustomer> {
  const customer = await mintCustomer({
    email: opts.email ?? `${marker}-${Math.random().toString(36).slice(2, 7)}@customers.example`,
    name: opts.name,
  })
  const context = await portalContext(browser, customer)
  return { ...customer, api: context.request, close: () => context.close() }
}

/** A post a customer submits on the portal (createPublicPostFn). */
export async function customerPost(
  customer: Pick<PortalCustomer, 'api'>,
  input: { boardId: string; title: string; content?: string }
): Promise<{ id: string; statusId: string | null }> {
  const res = await callServerFn<{ id: string; statusId: string | null }>(
    customer.api,
    'createPublicPostFn',
    { content: '', ...input }
  )
  return must(res, 'createPublicPostFn')
}

/** A post status's TypeID by slug (the seed has open, under_review, planned, in_progress, complete, closed). */
export async function statusIdBySlug(slug: string): Promise<string> {
  const [row] = await supportDb()`
    SELECT id FROM post_statuses WHERE slug = ${slug} AND deleted_at IS NULL LIMIT 1`
  if (!row) throw new Error(`No live status with slug ${slug}`)
  return fromUuid('post_status', String(row.id))
}

/** The raw uuid behind a TypeID, for SQL. */
export function uuid(typeId: string): string {
  return toUuid(typeId as never)
}

/** The post's row (snake_case columns), or undefined. */
export async function postRow(postId: string): Promise<Record<string, unknown> | undefined> {
  const [row] = await supportDb()`SELECT * FROM posts WHERE id = ${uuid(postId)}`
  return row
}

/**
 * Open the feedback inbox with these URL search params. Arrays and booleans
 * are written the router's way (JSON), so `{ board: [id] }` scopes the list to
 * one board: do that in every inbox test, the list is shared.
 */
export async function openInbox(
  page: Page,
  params: Record<string, string | string[] | boolean | number> = {}
): Promise<void> {
  const qs = new URLSearchParams(
    Object.entries(params).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)])
  ).toString()
  await page.goto(`/admin/feedback${qs ? `?${qs}` : ''}`)
}

/** Titles of the inbox rows on screen that contain `marker`, top to bottom. */
export async function inboxTitles(page: Page, marker: string): Promise<string[]> {
  const titles = await page.locator('h3').allInnerTexts()
  return titles.map((t) => t.trim()).filter((t) => t.includes(marker))
}

/** Open a post's modal straight from its URL and wait for its title. */
export async function openPost(page: Page, postId: string, title?: string): Promise<void> {
  await page.goto(`/admin/feedback?post=${encodeURIComponent(postId)}`)
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible({ timeout: 15_000 })
  if (title) await expect(dialog.getByText(title).first()).toBeVisible()
}
