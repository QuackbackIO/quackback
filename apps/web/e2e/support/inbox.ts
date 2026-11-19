/**
 * Inbox helpers for the support suite (teammate side of the core loop).
 *
 *   import { test, expect } from '../../support/inbox'
 *
 * Adds two fixtures on top of the suite's own (`fixtures.ts`):
 * - `teammate(opts)` mints a FRESH teammate (user, principal, role, teams and a
 *   signed-in session) and returns a signed-in Page. A minted teammate has no
 *   other test's assignments, mentions, bells, mail or presence, so per-person
 *   counts and lists are exact.
 * - `seed(opts)` writes one conversation straight to the database (a
 *   precondition only: it emits no live events). Every seeded conversation
 *   carries the test's marker in its visitor name and messages, so
 *   `/admin/inbox?q=<marker>` lists exactly this test's rows whatever else the
 *   shared workspace holds.
 */
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { fromUuid, generateId, toUuid } from '@quackback/ids'
import type { Browser, Locator, Page } from '@playwright/test'
import { pollFor, supportDb } from './db'
import { supportEnv } from './env'
import { test as base, expect } from './fixtures'

export { expect }

type Sql = ReturnType<typeof supportDb>

export interface MintedTeammate {
  name: string
  email: string
  userId: string
  /** TypeID, e.g. principal_01h... */
  principalId: string
  /** Raw uuid of the principal row. */
  principalUuid: string
  /** The Cookie header this teammate's session sends. */
  cookie: string
}

export interface MintTeammateOptions {
  /** Workspace-wide role key (admin, manager, support_lead, contributor, e2e_scoped_agent...). */
  role?: string
  /** Team TypeIDs to join. */
  teams?: string[]
  /** Display name; default "Tess <suffix>". */
  name?: string
}

/** Create a teammate with a signed-in session, straight in the database. */
export async function mintTeammate(
  marker: string,
  opts: MintTeammateOptions = {}
): Promise<MintedTeammate> {
  const sql = supportDb()
  const suffix = randomBytes(3).toString('hex')
  const name = opts.name ?? `Tess ${suffix}`
  const email = `${marker}-${suffix}@teammates.example`
  const role = opts.role ?? 'admin'
  const userUuid = toUuid(generateId('user'))
  const principalUuid = toUuid(generateId('principal'))
  await sql`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
            VALUES (${userUuid}, ${name}, ${email}, true, NOW(), NOW())`
  await sql`INSERT INTO principal (id, user_id, role, type, display_name, created_at)
            VALUES (${principalUuid}, ${userUuid}, ${role === 'admin' || role === 'owner' ? 'admin' : 'member'},
                    'user', ${name}, NOW())`
  const [roleRow] = await sql<{ id: string }[]>`SELECT id FROM roles WHERE key = ${role}`
  if (!roleRow) throw new Error(`role not found: ${role}`)
  await sql`INSERT INTO principal_role_assignments (id, principal_id, role_id, created_at)
            VALUES (${toUuid(generateId('role_asgn'))}, ${principalUuid}, ${roleRow.id}, NOW())`
  for (const team of opts.teams ?? []) {
    await sql`INSERT INTO team_members (id, team_id, principal_id)
              VALUES (${toUuid(generateId('team_member'))}, ${toUuid(team as `team_${string}`)}, ${principalUuid})`
  }
  // The same signed-cookie session e2e/scripts/mint-support-sessions.ts writes.
  const token = randomBytes(24).toString('base64url')
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
  await sql`INSERT INTO session (id, expires_at, token, created_at, updated_at, user_agent, scope, user_id)
            VALUES (${randomUUID()}, ${expiresAt}, ${token}, NOW(), NOW(), 'support-e2e', 'dashboard', ${userUuid})`
  const signature = createHmac('sha256', supportEnv().app.SECRET_KEY).update(token).digest('base64')
  const value = encodeURIComponent(`${token}.${signature}`)
  return {
    name,
    email,
    userId: fromUuid('user', userUuid),
    principalId: fromUuid('principal', principalUuid),
    principalUuid,
    cookie: `better-auth.session_token=${value}`,
  }
}

async function pageFor(browser: Browser, mate: MintedTeammate): Promise<Page> {
  const [cookieName, cookieValue] = mate.cookie.split('=')
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    storageState: {
      cookies: [
        {
          name: cookieName,
          value: cookieValue,
          domain: new URL(supportEnv().baseUrl).hostname,
          path: '/',
          expires: Math.floor(Date.now() / 1000) + 24 * 3600,
          httpOnly: true,
          secure: false,
          sameSite: 'Lax',
        },
      ],
      origins: [],
    },
  })
  return context.newPage()
}

export interface SeedConversationOptions {
  /** Visitor display name; default "Visitor <marker>". */
  visitorName?: string
  /** Attach to (or create) a user with this email instead of an anonymous visitor. */
  visitorEmail?: string
  /** Mark the visitor as a test customer of this principal (TypeID). */
  testOwner?: string
  status?: 'open' | 'snoozed' | 'closed'
  /** Assignee principal TypeID. */
  assignee?: string
  /** Team TypeID. */
  team?: string
  priority?: 'none' | 'low' | 'medium' | 'high' | 'urgent'
  channel?: 'messenger' | 'email'
  endReason?: string
  spamReason?: string
  snoozedUntil?: Date | null
  /** Visitor messages, oldest first; default one message carrying the marker. */
  messages?: string[]
  /** Minutes ago the last message landed (default 0); earlier ones are 1 minute apart. */
  ageMinutes?: number
  subject?: string
}

export interface SeededConversation {
  /** TypeID (conversation_...). */
  id: string
  uuid: string
  visitorUuid: string
  visitorName: string
  messages: string[]
  /** Message TypeIDs, oldest first. */
  messageIds: string[]
}

async function visitorPrincipal(
  sql: Sql,
  opts: SeedConversationOptions,
  name: string
): Promise<string> {
  const testOwner = opts.testOwner ? toUuid(opts.testOwner as `principal_${string}`) : null
  if (opts.visitorEmail) {
    const [user] = await sql<{ id: string }[]>`
      SELECT id FROM "user" WHERE lower(email) = lower(${opts.visitorEmail})`
    let userUuid = user?.id
    if (!userUuid) {
      userUuid = toUuid(generateId('user'))
      await sql`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
                VALUES (${userUuid}, ${name}, ${opts.visitorEmail}, true, NOW(), NOW())`
    }
    const [existing] = await sql<
      { id: string }[]
    >`SELECT id FROM principal WHERE user_id = ${userUuid}`
    if (existing) return existing.id
    const uuid = toUuid(generateId('principal'))
    await sql`INSERT INTO principal (id, user_id, role, type, display_name, contact_email, created_at, test_owner_principal_id)
              VALUES (${uuid}, ${userUuid}, 'user', 'user', ${name}, ${opts.visitorEmail}, NOW(), ${testOwner})`
    return uuid
  }
  const uuid = toUuid(generateId('principal'))
  await sql`INSERT INTO principal (id, user_id, role, type, display_name, created_at, test_owner_principal_id)
            VALUES (${uuid}, NULL, 'user', 'anonymous', ${name}, NOW(), ${testOwner})`
  return uuid
}

/** Write one conversation (and its visitor messages) for this test. */
export async function seedConversation(
  marker: string,
  opts: SeedConversationOptions = {}
): Promise<SeededConversation> {
  const sql = supportDb()
  const visitorName = opts.visitorName ?? `Visitor ${marker}`
  const visitorUuid = await visitorPrincipal(sql, opts, visitorName)
  const messages = opts.messages ?? [`Hello from ${marker}`]
  const age = opts.ageMinutes ?? 0
  const id = generateId('conversation')
  const uuid = toUuid(id)
  const status = opts.status ?? 'open'
  await sql`
    INSERT INTO conversations
      (id, visitor_principal_id, status, channel, priority, subject, last_message_preview,
       last_message_at, created_at, assigned_agent_principal_id, assigned_team_id,
       end_reason, spam_reason, snoozed_until, waiting_since, resolved_at, visitor_email)
    VALUES
      (${uuid}, ${visitorUuid}, ${status}, ${opts.channel ?? 'messenger'}, ${opts.priority ?? 'none'},
       ${opts.subject ?? null}, ${messages[messages.length - 1]},
       NOW() - make_interval(mins => ${age}),
       NOW() - make_interval(mins => ${age + messages.length}),
       ${opts.assignee ? toUuid(opts.assignee as `principal_${string}`) : null},
       ${opts.team ? toUuid(opts.team as `team_${string}`) : null},
       ${opts.endReason ?? null}, ${opts.spamReason ?? null}, ${opts.snoozedUntil ?? null},
       ${status === 'open' ? sql`NOW() - make_interval(mins => ${age})` : null},
       ${status === 'closed' ? sql`NOW()` : null}, ${opts.visitorEmail ?? null})`
  const messageIds: string[] = []
  for (let i = 0; i < messages.length; i++) {
    const msgId = generateId('conversation_msg')
    messageIds.push(msgId)
    await sql`
      INSERT INTO conversation_messages
        (id, conversation_id, principal_id, sender_type, content, is_internal, created_at)
      VALUES
        (${toUuid(msgId)}, ${uuid}, ${visitorUuid}, 'visitor', ${messages[i]}, false,
         NOW() - make_interval(mins => ${age + messages.length - 1 - i}))`
  }
  return { id, uuid, visitorUuid, visitorName, messages, messageIds }
}

export interface ConversationState {
  status: string
  assigned_agent_principal_id: string | null
  assigned_team_id: string | null
  priority: string
  snoozed_until: Date | null
  end_reason: string | null
  spam_reason: string | null
  agent_last_read_at: Date | null
  waiting_since: Date | null
  last_message_preview: string | null
  custom_attributes: Record<string, unknown>
}

export async function conversationState(uuid: string): Promise<ConversationState> {
  const [row] = await supportDb()<ConversationState[]>`
    SELECT status, assigned_agent_principal_id, assigned_team_id, priority, snoozed_until,
           end_reason, spam_reason, agent_last_read_at, waiting_since, last_message_preview,
           custom_attributes
    FROM conversations WHERE id = ${uuid}`
  if (!row) throw new Error(`conversation ${uuid} not found`)
  return row
}

/** Poll the conversation until `check` passes (returns true). */
export async function waitForConversation(
  uuid: string,
  what: string,
  check: (row: ConversationState) => boolean,
  timeoutMs = 10_000
): Promise<ConversationState> {
  return pollFor(
    what,
    async () => {
      const row = await conversationState(uuid)
      return check(row) ? row : null
    },
    { timeoutMs }
  )
}

export interface MessageRow {
  id: string
  sender_type: string
  content: string
  is_internal: boolean
  principal_id: string | null
  deleted_at: Date | null
  metadata: Record<string, unknown> | null
  created_at: Date
}

export async function messagesOf(uuid: string): Promise<MessageRow[]> {
  return supportDb()<MessageRow[]>`
    SELECT id, sender_type, content, is_internal, principal_id, deleted_at, metadata, created_at
    FROM conversation_messages WHERE conversation_id = ${uuid} ORDER BY created_at, id`
}

/** The conversation (uuid) a message with this exact text belongs to. */
export async function conversationWithMessage(text: string, timeoutMs = 15_000): Promise<string> {
  return pollFor(
    `a conversation with message "${text}"`,
    async () => {
      const [row] = await supportDb()<{ conversation_id: string }[]>`
        SELECT conversation_id FROM conversation_messages WHERE content LIKE ${'%' + text + '%'}
        ORDER BY created_at LIMIT 1`
      return row?.conversation_id ?? null
    },
    { timeoutMs }
  )
}

/** A conversation label (tag) of this test's own. */
export async function seedTag(name: string): Promise<{ id: string; uuid: string; name: string }> {
  const id = generateId('conversation_tag')
  await supportDb()`INSERT INTO conversation_tags (id, name, color) VALUES (${toUuid(id)}, ${name}, '#2563eb')`
  return { id, uuid: toUuid(id), name }
}

export async function tagConversation(conversationUuid: string, tagUuid: string): Promise<void> {
  await supportDb()`INSERT INTO conversation_tag_assignments (conversation_id, conversation_tag_id)
                    VALUES (${conversationUuid}, ${tagUuid})`
}

/** An internal note by `author` (principal TypeID) that mentions `mentioned`. */
export async function seedMentionNote(
  conversationUuid: string,
  author: string,
  mentioned: string,
  text: string
): Promise<void> {
  const sql = supportDb()
  const msg = toUuid(generateId('conversation_msg'))
  await sql`INSERT INTO conversation_messages
              (id, conversation_id, principal_id, sender_type, content, is_internal, created_at)
            VALUES (${msg}, ${conversationUuid}, ${toUuid(author as `principal_${string}`)}, 'agent',
                    ${text}, true, NOW())`
  await sql`INSERT INTO conversation_message_mentions (id, conversation_message_id, principal_id)
            VALUES (${randomUUID()}, ${msg},
                    ${toUuid(mentioned as `principal_${string}`)})`
}

export interface BellRow {
  type: string
  title: string
  body: string | null
  metadata: Record<string, unknown> | null
}

/** A teammate's in-app notifications (bells), newest first. */
export async function bellsFor(principalUuid: string): Promise<BellRow[]> {
  return supportDb()<BellRow[]>`
    SELECT type, title, body, metadata FROM in_app_notifications
    WHERE principal_id = ${principalUuid} ORDER BY created_at DESC`
}

export function conversationTypeId(uuid: string): string {
  return fromUuid('conversation', uuid)
}

// ---------------------------------------------------------------------------
// Page helpers
// ---------------------------------------------------------------------------

/** The inbox list filtered to this test's rows (search by marker). */
export function inboxUrl(params: Record<string, string | undefined> = {}): string {
  const search = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined) search.set(k, v)
  const qs = search.toString()
  return `/admin/inbox${qs ? `?${qs}` : ''}`
}

/** Every list row (conversation or ticket) whose text contains `text`. */
export function listRows(page: Page, text: string): Locator {
  return page.locator('div.group').filter({ hasText: text })
}

/** The details panel (shown at 1680px and up). */
export function detailsPanel(page: Page): Locator {
  return page.getByRole('complementary', { name: 'Item details' })
}

/** The composer's editor. */
export function composer(page: Page): Locator {
  return page.locator('.ProseMirror[contenteditable="true"]').last()
}

/** Open a conversation by URL and wait for its first message. */
export async function openConversation(
  page: Page,
  conversationId: string,
  firstText: string,
  extra: Record<string, string> = {}
): Promise<void> {
  await page.goto(inboxUrl({ i: conversationId, ...extra }))
  await expect(page.getByText(firstText).first()).toBeVisible({ timeout: 20_000 })
  // The page is server-rendered; wait for hydration before driving controls.
  await expect(composer(page)).toBeVisible({ timeout: 15_000 })
}

/** Type into the composer and send in the current mode (Reply or Note). */
export async function sendFromComposer(page: Page, text: string, mode: 'reply' | 'note') {
  const editor = composer(page)
  await editor.click()
  await editor.fill(text)
  await page.getByRole('button', { name: mode === 'note' ? 'Add note' : 'Send reply' }).click()
}

/** Switch the composer between Reply and Note. */
export async function setComposerMode(page: Page, mode: 'reply' | 'note'): Promise<void> {
  const current = mode === 'note' ? 'Reply' : 'Note'
  await page.getByRole('button', { name: current, exact: true }).click()
  await page.getByRole('menuitemradio', { name: mode === 'note' ? 'Note' : 'Reply' }).click()
}

/** Click a server-rendered control until the click lands after hydration. */
export async function clickUntil(
  target: Locator,
  done: () => Promise<void>,
  timeout = 15_000
): Promise<void> {
  await expect(async () => {
    await target.click()
    await done()
  }).toPass({ timeout })
}

/** The anonymous widget: open /widget, start a conversation and send `text`. */
export async function widgetStartConversation(page: Page, text: string): Promise<void> {
  await page.goto('/widget')
  await page.getByRole('button', { name: 'Messages', exact: true }).click()
  await page.getByRole('button', { name: /Ask a question/ }).click()
  const editor = page.locator('.ProseMirror[contenteditable="true"]')
  await expect(editor).toBeVisible({ timeout: 10_000 })
  await editor.click()
  await editor.fill(text)
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByText(text)).toBeVisible({ timeout: 15_000 })
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface InboxFixtures {
  /** Mint a fresh teammate and return a signed-in Page (1920x1080) for them. */
  teammate: (opts?: MintTeammateOptions) => Promise<{ page: Page; mate: MintedTeammate }>
  /** Seed a conversation for this test (see seedConversation). */
  seed: (opts?: SeedConversationOptions) => Promise<SeededConversation>
}

export const test = base.extend<InboxFixtures>({
  teammate: async ({ browser, marker }, use) => {
    const pages: Page[] = []
    await use(async (opts) => {
      const mate = await mintTeammate(marker, opts)
      const page = await pageFor(browser, mate)
      pages.push(page)
      return { page, mate }
    })
    for (const page of pages) await page.context().close()
  },
  seed: async ({ marker }, use) => {
    await use((opts) => seedConversation(marker, opts))
  },
})
