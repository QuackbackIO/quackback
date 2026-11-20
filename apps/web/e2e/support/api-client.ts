/**
 * Helpers for the support REST and MCP specs (api, api-tickets, mcp).
 *
 *   const { key } = createKey({ creatorEmail: people.people.admin.email, kind: 'workspace' })
 *   const api = await apiFor(playwright, baseURL, key)       // REST, Bearer key
 *   const res = await mcpCall(api, 'list_conversations', {}) // MCP tools/call
 *
 * Every context sends its own client address in `x-e2e-client-ip` (support.env
 * sets TRUSTED_CLIENT_IP_HEADER to it), so the 100-a-minute per-address rate
 * limit never couples parallel tests.
 */
import { execFileSync } from 'node:child_process'
import { randomInt } from 'node:crypto'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  expect,
  type APIRequestContext,
  type APIResponse,
  type PlaywrightWorkerArgs,
} from '@playwright/test'
import { fromUuid, generateId, toUuid } from '@quackback/ids'
import { pollFor, supportDb } from './db'
import { sendInboundEmail, supportInboxAddress } from './inbound-email'

const here = dirname(fileURLToPath(import.meta.url))

/** A parsed JSON body: whatever JSON.parse gives, read field by field by the specs. */
export type Wire = ReturnType<typeof JSON.parse>

function runScript(file: string, args: string[]): string {
  const envFile = process.env.E2E_ENV_FILE ?? '../../.env'
  try {
    return execFileSync(
      'bun',
      [`--env-file=${envFile}`, resolve(here, '../scripts', file), ...args],
      {
        encoding: 'utf-8',
        cwd: resolve(here, '../..'),
      }
    ).trim()
  } catch (error) {
    const err = error as { stderr?: string; message: string }
    throw new Error(`${file} failed: ${err.stderr || err.message}`, { cause: error })
  }
}

// ---------------------------------------------------------------------------
// Keys, teammates and their changes
// ---------------------------------------------------------------------------

export interface KeyOptions {
  creatorEmail: string
  kind?: 'personal' | 'workspace'
  roleKey?: string
  scopes?: string[]
  legacy?: boolean
  expiresAt?: string
  name?: string
}

export interface CreatedKey {
  key: string
  id: string
  principalId: string
}

/** Create an API key through the app's service (e2e/scripts/support-api-key.ts). */
export function createKey(opts: KeyOptions): CreatedKey {
  return JSON.parse(runScript('support-api-key.ts', [JSON.stringify(opts)])) as CreatedKey
}

export interface Teammate {
  email: string
  userId: string
  principalId: string
  roleId: string
}

/** A fresh teammate with its own custom role (exactly `permissions`) and teams. */
export function newTeammate(name: string, permissions: string[], teams: string[] = []): Teammate {
  return JSON.parse(
    runScript('support-api-fixtures.ts', [
      JSON.stringify({ op: 'teammate', name, permissions, teams }),
    ])
  ) as Teammate
}

/**
 * An MCP OAuth access token for a person (by email) with `scopes`, signed by
 * the app's own keys (e2e/scripts/support-mcp-token.ts).
 */
export function mcpOAuthToken(email: string, scopes: string[]): string {
  return runScript('support-mcp-token.ts', [JSON.stringify({ email, scopes })])
}

type FixtureOp =
  | { op: 'setPermissions'; roleId: string; permissions: string[] }
  | { op: 'leave' | 'block'; principalId: string }
  | { op: 'revoke' | 'expire' | 'backdateKey'; keyId: string }
  | { op: 'applySla'; conversationId: string }
  | { op: 'enablePortalMcp' }

export function fixture(op: FixtureOp): void {
  runScript('support-api-fixtures.ts', [JSON.stringify(op)])
}

/** The permissions a working inbox teammate needs for the support API. */
export const INBOX_PERMISSIONS = [
  'conversation.view',
  'conversation.reply',
  'conversation.note',
  'conversation.assign',
  'conversation.set_status',
  'conversation.set_tags',
  'ticket.view',
  'ticket.create',
  'ticket.reply',
  'ticket.note',
  'ticket.assign',
  'ticket.set_status',
  'member.view',
]

// ---------------------------------------------------------------------------
// Request contexts
// ---------------------------------------------------------------------------

/** A loopback-free client address unique enough per context. */
export function clientIp(): string {
  return `10.${randomInt(1, 255)}.${randomInt(0, 256)}.${randomInt(1, 255)}`
}

/** A request context authenticated with `key` (Bearer), with its own client address. */
export async function apiFor(
  playwright: PlaywrightWorkerArgs['playwright'],
  baseURL: string | undefined,
  key: string | null,
  extraHeaders: Record<string, string> = {}
): Promise<APIRequestContext> {
  return playwright.request.newContext({
    baseURL,
    extraHTTPHeaders: {
      ...(key ? { authorization: `Bearer ${key}` } : {}),
      'x-e2e-client-ip': clientIp(),
      ...extraHeaders,
    },
  })
}

/** Read a JSON body, failing with the raw text when the status is not `status`. */
export async function expectJson<T = Wire>(res: APIResponse, status: number): Promise<T> {
  const text = await res.text()
  expect(res.status(), text).toBe(status)
  return JSON.parse(text) as T
}

// ---------------------------------------------------------------------------
// MCP
// ---------------------------------------------------------------------------

export interface McpToolResult {
  status: number
  isError: boolean
  text: string
  /** The first text block parsed as JSON, or null. */
  json: Wire
  raw: Wire
}

let rpcId = 0

/** POST one JSON-RPC message to /api/mcp. */
export async function mcpRpc(
  api: APIRequestContext,
  method: string,
  params: Record<string, unknown> = {}
): Promise<APIResponse> {
  return api.post('/api/mcp', {
    headers: { accept: 'application/json, text/event-stream' },
    data: { jsonrpc: '2.0', id: ++rpcId, method, params },
  })
}

/** Call one MCP tool and unwrap its first text block. */
export async function mcpCall(
  api: APIRequestContext,
  name: string,
  args: Record<string, unknown> = {}
): Promise<McpToolResult> {
  const res = await mcpRpc(api, 'tools/call', { name, arguments: args })
  const body = await res.text()
  expect(res.status(), body).toBe(200)
  const raw = JSON.parse(body)
  if (raw.error) throw new Error(`MCP ${name} JSON-RPC error: ${JSON.stringify(raw.error)}`)
  const text: string = raw.result?.content?.[0]?.text ?? ''
  let json: Wire = null
  try {
    json = JSON.parse(text)
  } catch {
    json = null
  }
  return { status: res.status(), isError: raw.result?.isError === true, text, json, raw }
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

/**
 * Open a conversation the way a customer does (signed inbound email), so the
 * app's own create path runs and its events fire. Returns the TypeIDs.
 */
export async function emailConversation(
  request: APIRequestContext,
  from: string,
  marker: string,
  text = `Hello, I need help with ${marker}.`
): Promise<{ conversationId: string; visitorPrincipalId: string }> {
  const messageId = `<${marker}-${Date.now()}@customers.example>`
  const res = await sendInboundEmail(request, {
    from,
    to: supportInboxAddress(),
    subject: `Help ${marker}`,
    text,
    messageId,
  })
  expect(res.status(), await res.text()).toBe(200)
  const sql = supportDb()
  const needle = `%${messageId.slice(1, -1)}%`
  const row = await pollFor(`conversation for ${messageId}`, async () => {
    const [r] = await sql`
      SELECT c.id, c.visitor_principal_id FROM conversation_messages m
      JOIN conversations c ON c.id = m.conversation_id
      WHERE m.metadata ->> 'emailMessageId' LIKE ${needle} LIMIT 1`
    return r ?? null
  })
  return {
    conversationId: fromUuid('conversation', row.id as string),
    visitorPrincipalId: fromUuid('principal', row.visitor_principal_id as string),
  }
}

export function uuidOf(typeId: string): string {
  return toUuid(typeId as `conversation_${string}`)
}

/** Put a conversation on a team (and optionally an assignee) directly. */
export async function placeConversation(
  conversationId: string,
  opts: { teamId?: string | null; assigneePrincipalId?: string | null }
): Promise<void> {
  const sql = supportDb()
  const team = opts.teamId ? uuidOf(opts.teamId) : null
  const agent = opts.assigneePrincipalId ? uuidOf(opts.assigneePrincipalId) : null
  await sql`UPDATE conversations SET assigned_team_id = ${team}, assigned_agent_principal_id = ${agent}
            WHERE id = ${uuidOf(conversationId)}`
}

/** Put a ticket on a team (and optionally an assignee) directly. */
export async function placeTicket(
  ticketId: string,
  opts: { teamId?: string | null; assigneePrincipalId?: string | null }
): Promise<void> {
  const sql = supportDb()
  const team = opts.teamId ? uuidOf(opts.teamId) : null
  const agent = opts.assigneePrincipalId ? uuidOf(opts.assigneePrincipalId) : null
  await sql`UPDATE tickets SET assignee_team_id = ${team}, assignee_principal_id = ${agent}
            WHERE id = ${uuidOf(ticketId)}`
}

/** Events rows recorded for one entity (newest last). */
export async function eventsFor(
  entityId: string,
  types?: string[]
): Promise<Array<{ type: string; actor_type: string; actor_id: string | null; payload: Wire }>> {
  const sql = supportDb()
  const rows = await sql`
    SELECT type, actor_type, actor_id, payload FROM events
    WHERE (entity_id = ${entityId} OR payload::text LIKE ${`%${entityId}%`})
    ORDER BY id`
  const all = rows as unknown as Array<{
    type: string
    actor_type: string
    actor_id: string | null
    payload: Wire
  }>
  return types ? all.filter((r) => types.includes(r.type)) : all
}

/**
 * Seed one open messenger conversation straight into the database (no events:
 * for read and scope checks). Activity time is now unless `ageMinutes` is set,
 * so later seeds list first.
 */
export async function seedConv(
  subject: string,
  opts: {
    teamId?: string | null
    assigneePrincipalId?: string | null
    status?: 'open' | 'snoozed' | 'closed'
    priority?: 'none' | 'low' | 'medium' | 'high' | 'urgent'
    ageMinutes?: number
  } = {}
): Promise<{ conversationId: string; visitorPrincipalId: string; message: string }> {
  const sql = supportDb()
  const visitor = toUuid(generateId('principal'))
  await sql`INSERT INTO principal (id, user_id, role, type, display_name, created_at)
            VALUES (${visitor}, NULL, 'user', 'anonymous', 'E2E Visitor', NOW())`
  const conversationTypeId = generateId('conversation')
  const id = toUuid(conversationTypeId)
  const message = `${subject} - visitor message`
  const age = opts.ageMinutes ?? 0
  await sql`
    INSERT INTO conversations
      (id, visitor_principal_id, status, channel, priority, subject, last_message_preview,
       last_message_at, created_at, assigned_team_id, assigned_agent_principal_id)
    VALUES (${id}, ${visitor}, ${opts.status ?? 'open'}, 'messenger', ${opts.priority ?? 'none'},
            ${subject}, ${message}, NOW() - make_interval(mins => ${age}),
            NOW() - make_interval(mins => ${age}),
            ${opts.teamId ? uuidOf(opts.teamId) : null},
            ${opts.assigneePrincipalId ? uuidOf(opts.assigneePrincipalId) : null})`
  await sql`
    INSERT INTO conversation_messages
      (id, conversation_id, principal_id, sender_type, content, is_internal, created_at)
    VALUES (${toUuid(generateId('conversation_msg'))}, ${id}, ${visitor}, 'visitor', ${message},
            false, NOW() - make_interval(mins => ${age + 1}))`
  return {
    conversationId: conversationTypeId,
    visitorPrincipalId: fromUuid('principal', visitor),
    message,
  }
}

/** A fresh identified customer (user + principal), for ticket requesters. */
export async function seedCustomer(
  email: string,
  name = 'E2E Customer'
): Promise<{ principalId: string; userId: string }> {
  const sql = supportDb()
  const userId = toUuid(generateId('user'))
  await sql`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
            VALUES (${userId}, ${name}, ${email}, true, NOW(), NOW())`
  const principalId = toUuid(generateId('principal'))
  await sql`INSERT INTO principal (id, user_id, role, type, display_name, created_at)
            VALUES (${principalId}, ${userId}, 'user', 'user', ${name}, NOW())`
  return { principalId: fromUuid('principal', principalId), userId: fromUuid('user', userId) }
}

/** The conversation backing a customer ticket, or null. */
export async function backingConversationOf(ticketId: string): Promise<string | null> {
  const sql = supportDb()
  const [row] = await sql`SELECT conversation_id FROM ticket_conversations
                          WHERE ticket_id = ${uuidOf(ticketId)} LIMIT 1`
  return row ? fromUuid('conversation', row.conversation_id as string) : null
}

/** A conversation tag, created straight in the database. Returns its TypeID. */
export async function seedTag(name: string): Promise<string> {
  const sql = supportDb()
  const typeId = generateId('conversation_tag')
  await sql`INSERT INTO conversation_tags (id, name) VALUES (${toUuid(typeId)}, ${name})`
  return typeId
}

/**
 * Page a list endpoint newest first until every id in `want` has been seen,
 * returning every id seen on the way. Seed the items that must be absent
 * AFTER the ones that must be present: newest-first order then puts any
 * leaked one on a page this walk reads.
 */
export async function pageUntilSeen(
  fetchPage: (cursor: string | null) => Promise<{ ids: string[]; cursor: string | null }>,
  want: string[],
  maxPages = 20
): Promise<Set<string>> {
  const seen = new Set<string>()
  let cursor: string | null = null
  for (let page = 0; page < maxPages; page++) {
    const res = await fetchPage(cursor)
    for (const id of res.ids) seen.add(id)
    if (want.every((id) => seen.has(id)) || !res.cursor) break
    cursor = res.cursor
  }
  return seen
}

/** Wait until an event of `type` mentioning `entityId` is recorded. */
export async function waitForEvent(entityId: string, type: string, timeoutMs = 10_000) {
  return pollFor(
    `${type} event for ${entityId}`,
    async () => {
      const rows = await eventsFor(entityId, [type])
      return rows.length > 0 ? rows : null
    },
    { timeoutMs }
  )
}
