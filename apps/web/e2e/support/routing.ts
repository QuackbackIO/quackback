/**
 * Helpers for the routing and assignment specs (routing.spec.ts,
 * routing-teams.spec.ts). Those specs run in the `support-serial` project, so
 * they may switch routing on and clear presence: nothing else runs meanwhile.
 *
 * - `setRouting(playwright, on)` flips the switch through the app's own server
 *   function, as the admin.
 * - `resetRoutingState()` clears every presence row, so "who is online" is
 *   only what the test itself opens.
 * - `createCustomer(marker)` makes a signed-in customer of its own (the send
 *   rate limit is per customer), and `customerSays` starts or continues their
 *   conversation through the same server function the portal uses.
 * - `goOnline(teammate)` holds a presence stream open for a teammate.
 */
import type { APIRequestContext, PlaywrightWorkerArgs } from '@playwright/test'
import { fromUuid, generateId, toUuid } from '@quackback/ids'
import { pollFor, supportDb } from './db'
import { supportEnv } from './env'
import { waitForPresence } from './presence'
import { callServerFn, personApi } from './server-fns'
import { openStream, type OpenStream } from './streams'
import { mintSession, type TestTeammate } from './teammates'

type Playwright = PlaywrightWorkerArgs['playwright']

const uuid = (id: string) => toUuid(id as `conversation_${string}`)

/** Switch conversation routing on or off as the admin (the app's own path). */
export async function setRouting(playwright: Playwright, enabled: boolean): Promise<void> {
  const admin = await personApi(playwright, 'admin')
  try {
    const res = await callServerFn(admin, 'updateConversationRoutingFn', {
      enabled,
      strategy: 'auto_assign_active',
    })
    if (!res.ok) throw new Error(`updateConversationRoutingFn failed: ${res.error.slice(0, 300)}`)
  } finally {
    await admin.dispose()
  }
}

/** Forget every presence row (serial specs only: nobody else is running). */
export async function clearAllPresence(): Promise<void> {
  await supportDb()`DELETE FROM presence_stream`
}

export interface TestCustomer {
  email: string
  name: string
  principalId: string
  storageState: Awaited<ReturnType<typeof mintSession>>
  api: (playwright: Playwright) => Promise<APIRequestContext>
}

/** A customer (portal user) only this test uses, signed in. */
export async function createCustomer(marker: string): Promise<TestCustomer> {
  const sql = supportDb()
  const suffix = Math.random().toString(36).slice(2, 8)
  const email = `${marker}-${suffix}@customers.example`
  const name = `Customer ${suffix}`
  const userUuid = toUuid(generateId('user'))
  const principalUuid = toUuid(generateId('principal'))
  await sql`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
            VALUES (${userUuid}, ${name}, ${email}, true, NOW(), NOW())`
  await sql`INSERT INTO principal (id, user_id, role, type, display_name, created_at)
            VALUES (${principalUuid}, ${userUuid}, 'user', 'user', ${name}, NOW())`
  const storageState = await mintSession(fromUuid('user', userUuid))
  return {
    email,
    name,
    principalId: fromUuid('principal', principalUuid),
    storageState,
    api: (playwright) =>
      playwright.request.newContext({ baseURL: supportEnv().baseUrl, storageState }),
  }
}

/** The customer sends a message; the first one creates the conversation. */
export async function customerSays(
  api: APIRequestContext,
  content: string,
  conversationId?: string
): Promise<{ conversationId: string }> {
  const res = await callServerFn<{ conversation: { id: string } }>(
    api,
    'sendConversationMessageFn',
    { content, ...(conversationId ? { conversationId } : {}) }
  )
  if (!res.ok) throw new Error(`sendConversationMessageFn failed: ${res.error.slice(0, 300)}`)
  return { conversationId: res.data.conversation.id }
}

/** Hold a presence stream open for a test teammate until `close()`. */
export async function goOnline(
  teammate: Pick<TestTeammate, 'cookie' | 'principalId'>
): Promise<OpenStream> {
  const stream = await openStream({ cookie: teammate.cookie, query: { scope: 'presence' } })
  if (stream.status !== 200) throw new Error(`presence stream answered ${stream.status}`)
  await waitForPresence(teammate.principalId, true)
  return stream
}

export interface ConversationState {
  status: string
  assignedAgent: string | null
  assignedTeam: string | null
  snoozedUntil: Date | null
}

export async function conversationState(conversationId: string): Promise<ConversationState> {
  const [row] = await supportDb()`
    SELECT status, assigned_agent_principal_id, assigned_team_id, snoozed_until
    FROM conversations WHERE id = ${uuid(conversationId)}`
  if (!row) throw new Error(`No conversation ${conversationId}`)
  return {
    status: row.status as string,
    assignedAgent: row.assigned_agent_principal_id
      ? fromUuid('principal', row.assigned_agent_principal_id as string)
      : null,
    assignedTeam: row.assigned_team_id ? fromUuid('team', row.assigned_team_id as string) : null,
    snoozedUntil: (row.snoozed_until as Date | null) ?? null,
  }
}

/** Wait until the conversation's assignee is `principalId` (or null). */
export async function waitForAssignee(
  conversationId: string,
  principalId: string | null,
  timeoutMs = 10_000
): Promise<void> {
  await pollFor(
    `conversation ${conversationId} assigned to ${principalId ?? 'nobody'}`,
    async () =>
      (await conversationState(conversationId)).assignedAgent === principalId ? true : null,
    { timeoutMs }
  )
}

export interface SystemNotice {
  content: string
  isInternal: boolean
  kind: string | null
  workflowName: string | null
}

/** The author-less system notices on a conversation, oldest first. */
export async function systemNotices(conversationId: string): Promise<SystemNotice[]> {
  const rows = await supportDb()`
    SELECT content, is_internal, metadata FROM conversation_messages
    WHERE conversation_id = ${uuid(conversationId)} AND sender_type = 'system'
    ORDER BY created_at, id`
  return rows.map((r) => {
    const event = (r.metadata as { systemEvent?: Record<string, unknown> } | null)?.systemEvent
    return {
      content: r.content as string,
      isInternal: r.is_internal as boolean,
      kind: (event?.kind as string | undefined) ?? null,
      workflowName: (event?.workflowName as string | undefined) ?? null,
    }
  })
}

/** Wait until the conversation carries at least `count` assignment notices. */
export async function waitForAssignmentNotices(
  conversationId: string,
  count: number,
  timeoutMs = 10_000
): Promise<SystemNotice[]> {
  return pollFor(
    `${count} assignment notice(s) on ${conversationId}`,
    async () => {
      const notices = await assignmentNotices(conversationId)
      return notices.length >= count ? notices : null
    },
    { timeoutMs }
  )
}

/** Assignment notices (agent or team) on a conversation. */
export async function assignmentNotices(conversationId: string): Promise<SystemNotice[]> {
  return (await systemNotices(conversationId)).filter(
    (n) => n.kind === 'assigned' || n.kind === 'team_assigned'
  )
}

export interface Bell {
  type: string
  title: string
  metadata: Record<string, unknown> | null
}

/** A person's bells about one conversation (metadata.conversationId). */
export async function bellsFor(principalId: string, conversationId: string): Promise<Bell[]> {
  const rows = await supportDb()`
    SELECT type, title, metadata FROM in_app_notifications
    WHERE principal_id = ${toUuid(principalId as `principal_${string}`)}
      AND metadata->>'conversationId' = ${conversationId}
    ORDER BY created_at`
  return rows.map((r) => ({
    type: r.type as string,
    title: r.title as string,
    metadata: (r.metadata as Record<string, unknown> | null) ?? null,
  }))
}

/** Wait until `principalId` has a bell of `type` for the conversation. */
export async function waitForBell(
  principalId: string,
  conversationId: string,
  type: string,
  timeoutMs = 15_000
): Promise<Bell> {
  return pollFor(
    `a ${type} bell for ${principalId} on ${conversationId}`,
    async () => (await bellsFor(principalId, conversationId)).find((b) => b.type === type) ?? null,
    { timeoutMs }
  )
}

/** Rows in the events table for a conversation and type, newest last. */
export async function conversationEvents(
  conversationId: string,
  type: string
): Promise<Array<{ actorType: string; payload: Record<string, unknown> }>> {
  const rows = await supportDb()`
    SELECT actor_type, payload FROM events
    WHERE type = ${type} AND entity_id = ${conversationId}
    ORDER BY id`
  return rows.map((r) => ({
    actorType: r.actor_type as string,
    payload: r.payload as Record<string, unknown>,
  }))
}

/**
 * Seed `count` open conversations already assigned to `principalId`, to give
 * them a known load (no events: these are background work, not the subject).
 */
export async function seedLoad(principalId: string, count: number, marker: string): Promise<void> {
  const sql = supportDb()
  for (let i = 0; i < count; i++) {
    const visitor = toUuid(generateId('principal'))
    await sql`INSERT INTO principal (id, user_id, role, type, display_name, created_at)
              VALUES (${visitor}, NULL, 'user', 'anonymous', 'Load visitor', NOW())`
    await sql`INSERT INTO conversations
                (id, visitor_principal_id, status, channel, priority, subject,
                 assigned_agent_principal_id, last_message_at, created_at)
              VALUES (${toUuid(generateId('conversation'))}, ${visitor}, 'open', 'messenger', 'none',
                      ${`${marker} load ${i}`}, ${toUuid(principalId as `principal_${string}`)},
                      NOW(), NOW())`
  }
}

/** A custom role only this test uses, with exactly these permissions. Returns its key. */
export async function createRole(marker: string, permissions: string[]): Promise<string> {
  const sql = supportDb()
  const key = `e2e_${marker.replace(/[^a-z0-9]+/g, '_')}`.slice(0, 60)
  const roleId = toUuid(generateId('role'))
  await sql`INSERT INTO roles (id, key, name, description, is_system)
            VALUES (${roleId}, ${key}, ${`Role ${marker}`.slice(0, 60)},
                    ${'Support e2e test role'}, false)`
  const perms = await sql`SELECT id FROM permissions WHERE key IN ${sql(permissions)}`
  if (perms.length !== permissions.length) throw new Error(`Unknown permission in ${permissions}`)
  for (const perm of perms) {
    await sql`INSERT INTO role_permissions (id, role_id, permission_id)
              VALUES (${toUuid(generateId('role_perm'))}, ${roleId}, ${perm.id as string})`
  }
  return key
}

/** Wait for the conversation holding a message that contains `text`; returns its TypeID. */
export async function conversationWithMessage(text: string, timeoutMs = 15_000): Promise<string> {
  return pollFor(
    `a conversation with a message containing "${text}"`,
    async () => {
      const [row] = await supportDb()`
        SELECT conversation_id FROM conversation_messages
        WHERE content LIKE ${`%${text}%`} AND conversation_id IS NOT NULL LIMIT 1`
      return row ? fromUuid('conversation', row.conversation_id as string) : null
    },
    { timeoutMs }
  )
}

/** The admin's server-function client (dispose when done). */
export function adminApi(playwright: Playwright): Promise<APIRequestContext> {
  return personApi(playwright, 'admin')
}
