/**
 * Ticket helpers for the support suite (tests/support/tickets*.spec.ts).
 *
 * Preconditions go through the product's REST API (an API key per teammate,
 * minted once per worker) and, where the product has no API, short SQL
 * against the suite database. The action a test is about goes through the
 * product (UI or API); these helpers only set the stage and read results.
 */
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import type {
  APIRequestContext,
  Browser,
  Locator,
  Page,
  PlaywrightWorkerArgs,
} from '@playwright/test'
import { expect } from '@playwright/test'
import { fromUuid, toUuid } from '@quackback/ids'
import { createSupportApiKey } from '../utils/db-helpers'
import { pollFor, supportDb } from './db'
import { supportEnv } from './env'
import { SUPPORT_PEOPLE, type SupportPersonName } from './people'

type Playwright = PlaywrightWorkerArgs['playwright']

/** A REST ticket, as `serializeTicket` returns it. */
export interface ApiTicket {
  id: string
  number: number
  reference: string
  type: 'customer' | 'back_office' | 'tracker'
  title: string
  status: { name: string; category: 'open' | 'pending' | 'closed' }
  stage: string | null
  priority: string
  requesterPrincipalId: string | null
  assigneePrincipalId: string | null
  assigneeTeamId: string | null
  firstResponseAt: string | null
  resolvedAt: string | null
  reopenedCount: number
}

export interface ApiCustomer {
  principalId: string
  userId: string
  email: string
  name: string
}

const keyCache = new Map<string, string>()

/**
 * A request context authorised as `person` through an API key of `kind`.
 * Personal keys act as their creator; workspace keys as a service.
 */
export async function ticketApi(
  playwright: Playwright,
  baseURL: string | undefined,
  person: SupportPersonName = 'admin',
  kind: 'personal' | 'workspace' = 'personal'
): Promise<APIRequestContext> {
  const cacheKey = `${person}:${kind}`
  let key = keyCache.get(cacheKey)
  if (!key) {
    key = createSupportApiKey(SUPPORT_PEOPLE[person].email, kind)
    keyCache.set(cacheKey, key)
  }
  return playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: { authorization: `Bearer ${key}` },
  })
}

async function json<T>(res: Awaited<ReturnType<APIRequestContext['get']>>, what: string) {
  const text = await res.text()
  expect(res.ok(), `${what}: ${res.status()} ${text}`).toBe(true)
  return (JSON.parse(text) as { data: T }).data
}

/** A fresh verified customer (user + principal) through POST /users/identify. */
export async function createCustomer(
  api: APIRequestContext,
  email: string,
  name = `Customer ${email.split('@')[0].slice(-12)}`
): Promise<ApiCustomer> {
  const res = await api.post('/api/v1/users/identify', {
    data: { email, name, emailVerified: true },
  })
  const data = await json<ApiCustomer>(res, 'identify customer')
  return { ...data, email, name }
}

export interface CreateTicketBody {
  title: string
  type?: 'customer' | 'back_office' | 'tracker'
  ticketTypeId?: string
  description?: string
  priority?: string
  requesterPrincipalId?: string
}

/** POST /api/v1/tickets (customer tickets with a requester get a backing conversation). */
export async function createTicket(
  api: APIRequestContext,
  body: CreateTicketBody
): Promise<ApiTicket> {
  return json<ApiTicket>(await api.post('/api/v1/tickets', { data: body }), 'create ticket')
}

export async function getTicket(api: APIRequestContext, ticketId: string): Promise<ApiTicket> {
  return json<ApiTicket>(await api.get(`/api/v1/tickets/${ticketId}`), 'get ticket')
}

/** The id (TypeID) of the seeded ticket status called `name`. */
export async function statusId(name: string): Promise<string> {
  const [row] = await supportDb()<{ id: string }[]>`
    SELECT id FROM ticket_statuses WHERE name = ${name} AND deleted_at IS NULL LIMIT 1`
  if (!row) throw new Error(`no ticket status "${name}"`)
  return fromUuid('ticket_status', row.id)
}

export async function setStatus(api: APIRequestContext, ticketId: string, statusName: string) {
  return json<ApiTicket>(
    await api.post(`/api/v1/tickets/${ticketId}/status`, {
      data: { statusId: await statusId(statusName) },
    }),
    `set status ${statusName}`
  )
}

export async function replyToTicket(api: APIRequestContext, ticketId: string, content: string) {
  return json<{ id: string }>(
    await api.post(`/api/v1/tickets/${ticketId}/reply`, { data: { content } }),
    'reply to ticket'
  )
}

/** The paired conversation (TypeID) of a customer ticket, or null. */
export async function pairedConversationId(ticketId: string): Promise<string | null> {
  const [row] = await supportDb()<{ conversation_id: string }[]>`
    SELECT conversation_id FROM ticket_conversations
    WHERE ticket_id = ${toUuid(ticketId as `ticket_${string}`)} AND ticket_type = 'customer'`
  return row ? fromUuid('conversation', row.conversation_id) : null
}

/** The ticket row as stored. */
export async function ticketRow(ticketId: string) {
  const [row] = await supportDb()<
    {
      status_name: string
      status_category: string
      first_response_at: Date | null
      resolved_at: Date | null
      reopened_count: number
      assignee_principal_id: string | null
      assignee_team_id: string | null
      priority: string
      deleted_at: Date | null
      type: string
    }[]
  >`
    SELECT s.name AS status_name, s.category AS status_category, t.first_response_at,
           t.resolved_at, t.reopened_count, t.assignee_principal_id, t.assignee_team_id,
           t.priority, t.deleted_at, t.type
    FROM tickets t JOIN ticket_statuses s ON s.id = t.status_id
    WHERE t.id = ${toUuid(ticketId as `ticket_${string}`)}`
  return row
}

/** Activity kinds on a ticket, oldest first. */
export async function ticketActivity(ticketId: string) {
  return supportDb()<{ type: string; metadata: Record<string, unknown>; actor: string | null }[]>`
    SELECT type, metadata, principal_id AS actor FROM ticket_activity
    WHERE ticket_id = ${toUuid(ticketId as `ticket_${string}`)} ORDER BY created_at ASC`
}

/** Watchers of a ticket: principal uuid -> reason. */
export async function ticketWatchers(ticketId: string) {
  return supportDb()<{ principal_id: string; reason: string; muted_until: Date | null }[]>`
    SELECT principal_id, reason, muted_until FROM ticket_subscriptions
    WHERE ticket_id = ${toUuid(ticketId as `ticket_${string}`)}`
}

/** Bells (in-app notifications) a principal got for a ticket. */
export async function ticketBells(principalId: string, ticketId: string) {
  return supportDb()<{ type: string; title: string; metadata: Record<string, unknown> }[]>`
    SELECT type, title, metadata FROM in_app_notifications
    WHERE principal_id = ${toUuid(principalId as `principal_${string}`)}
      AND metadata->>'ticketId' = ${ticketId}
    ORDER BY created_at ASC`
}

/** Messages in a conversation (TypeID), oldest first. */
export async function conversationMessages(conversationId: string) {
  return supportDb()<
    {
      content: string
      sender_type: string
      is_internal: boolean
      metadata: Record<string, unknown> | null
    }[]
  >`
    SELECT content, sender_type, is_internal, metadata FROM conversation_messages
    WHERE conversation_id = ${toUuid(conversationId as `conversation_${string}`)}
      AND deleted_at IS NULL
    ORDER BY created_at ASC`
}

/** Messages parented on the ticket itself (not its paired conversation). */
export async function ticketOwnMessages(ticketId: string) {
  return supportDb()<{ content: string; sender_type: string; is_internal: boolean }[]>`
    SELECT content, sender_type, is_internal FROM conversation_messages
    WHERE ticket_id = ${toUuid(ticketId as `ticket_${string}`)} AND deleted_at IS NULL
    ORDER BY created_at ASC`
}

/** Poll the ticket row until `check` passes. */
export async function waitForTicket(
  ticketId: string,
  what: string,
  check: (row: NonNullable<Awaited<ReturnType<typeof ticketRow>>>) => boolean,
  timeoutMs = 15_000
) {
  return pollFor(
    what,
    async () => {
      const row = await ticketRow(ticketId)
      return row && check(row) ? row : null
    },
    { timeoutMs }
  )
}

/**
 * A browser signed in as `userId` (a fresh customer), by a minted session
 * row, the same way mint-support-sessions.ts signs in the seeded people.
 */
export async function signedInAs(browser: Browser, userId: string): Promise<Page> {
  const env = supportEnv()
  const secret = env.app.SECRET_KEY
  const token = randomBytes(24).toString('base64url')
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
  await supportDb()`
    INSERT INTO session (id, expires_at, token, created_at, updated_at, user_agent, scope, user_id)
    VALUES (${randomUUID()}, ${expiresAt}, ${token}, NOW(), NOW(), 'support-e2e', 'portal',
            ${toUuid(userId as `user_${string}`)})`
  const value = encodeURIComponent(
    `${token}.${createHmac('sha256', secret).update(token).digest('base64')}`
  )
  const domain = new URL(env.baseUrl).hostname
  const cookie = {
    value,
    domain,
    path: '/',
    expires: Math.floor(expiresAt.getTime() / 1000),
    httpOnly: true,
    sameSite: 'Lax' as const,
  }
  const context = await browser.newContext({
    storageState: {
      cookies: [
        { ...cookie, name: 'better-auth.session_token', secure: false },
        { ...cookie, name: '__Secure-better-auth.session_token', secure: true },
      ],
      origins: [],
    },
  })
  return context.newPage()
}

/** Open a ticket (or conversation) in the admin inbox and wait for its title. */
export async function openInInbox(page: Page, itemId: string, title: string): Promise<void> {
  await page.goto(`/admin/inbox?i=${itemId}`)
  await expect(page.getByText(title).first()).toBeVisible({ timeout: 20_000 })
}

/** Type into the inbox composer and press its send button. */
export async function sendFromComposer(
  page: Page,
  text: string,
  button: 'Send reply' | 'Add note' = 'Send reply'
): Promise<void> {
  const composer = page.locator('.ProseMirror[contenteditable="true"]').first()
  await composer.click()
  await composer.fill(text)
  await page.getByRole('button', { name: button }).click()
}

/** Switch the inbox composer to Note mode. */
export async function switchComposerToNote(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Reply', exact: true }).click()
  await page.getByRole('menuitemradio', { name: 'Note' }).click()
}

/**
 * A customer ticket for a fresh customer, paired with its backing
 * conversation (REST create with a requester).
 */
export async function pairedCustomerTicket(
  api: APIRequestContext,
  customerEmail: string,
  title: string,
  description = `Opening note for ${title}`
) {
  const customer = await createCustomer(api, customerEmail)
  const ticket = await createTicket(api, {
    title,
    type: 'customer',
    requesterPrincipalId: customer.principalId,
    description,
  })
  const conversationId = await pairedConversationId(ticket.id)
  if (!conversationId) throw new Error(`ticket ${ticket.id} has no paired conversation`)
  return { customer, ticket, conversationId }
}

/**
 * Make a teammate watch a ticket. A precondition only: the product's own
 * watch paths (TKT-53, TKT-54) are tested through the UI.
 */
export async function addWatcherRow(ticketId: string, principalId: string, reason = 'manual') {
  await supportDb()`
    INSERT INTO ticket_subscriptions (id, ticket_id, principal_id, reason)
    VALUES (${randomUUID()}, ${toUuid(ticketId as `ticket_${string}`)},
            ${toUuid(principalId as `principal_${string}`)}, ${reason})
    ON CONFLICT (ticket_id, principal_id) DO NOTHING`
}

/** The requester's portal view of a paired conversation. */
export async function openRequesterThread(page: Page, conversationId: string): Promise<void> {
  await page.goto(`/support/${conversationId}`)
  await expect(page.locator('[contenteditable="true"]').last()).toBeVisible({ timeout: 15_000 })
}

/** The inbox's right-hand detail panel (shown at the 1920px viewport). */
export function detailPanel(page: Page) {
  return page.getByRole('complementary', { name: 'Item details' })
}

/**
 * Click `trigger` until `appears` is visible. Server-rendered pages take
 * clicks before React hydrates; a first click can land on inert HTML.
 */
export async function clickUntilVisible(
  trigger: Locator,
  appears: Locator,
  timeoutMs = 20_000
): Promise<void> {
  await expect(async () => {
    // Never click again once it shows: a second click would toggle it shut.
    if (!(await appears.isVisible())) await trigger.click()
    await expect(appears).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: timeoutMs })
}

export interface TicketFieldDef {
  key: string
  label: string
  type: 'text' | 'long_text' | 'number' | 'select' | 'date' | 'checkbox'
  required: boolean
  visibleToCustomer: boolean
  options?: string[]
}

/**
 * A ticket type of the test's own (never a seeded default), as a
 * precondition. The settings UI path for types is TKT-20.
 */
export async function createTicketTypeRow(opts: {
  name: string
  category?: 'customer' | 'back_office' | 'tracker'
  fields?: TicketFieldDef[]
}): Promise<string> {
  const id = randomUUID()
  const slug = opts.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
  await supportDb()`
    INSERT INTO ticket_types (id, name, slug, category, fields, is_default, position)
    VALUES (${id}, ${opts.name}, ${slug}, ${opts.category ?? 'customer'},
            ${supportDb().json((opts.fields ?? []) as never)}, false, 100)`
  return fromUuid('ticket_type', id)
}

/** A principal TypeID as the uuid stored in the database. */
export function principalUuid(principalId: string): string {
  return toUuid(principalId as `principal_${string}`)
}
