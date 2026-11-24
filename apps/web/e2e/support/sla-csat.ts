/**
 * Helpers for the SLA, rating (CSAT) and notification-email journeys
 * (sla.spec.ts, sla-clocks.spec.ts, csat.spec.ts, notifications-email.spec.ts).
 *
 * - `callFn` calls the app's server functions the way the browser does, as a
 *   signed-in person (the production build names each one by a hash, so the id
 *   is looked up in the build's resolver manifest by function name).
 * - `seedPerson` makes a fresh customer or teammate with a minted session, so a
 *   test owns its recipients (mail to the shared people would mix with every
 *   other test's).
 * - `startEmailConversation` / `startPortalConversation` open a conversation
 *   through a real door (inbound email, the visitor's own send), so the default
 *   SLA and every event hook run.
 * - `ensureDefaultSla` makes the suite's default policy exist; tests read the
 *   due times off the stamp, never the policy's name (SLA-05 may switch the
 *   default to another policy of the same shape while other tests run).
 * - `withLiveWorkflow` publishes a workflow scoped to one test's customer and
 *   always takes it down again; `withSlaTimerLock` serialises the tests that
 *   publish SLA timer workflows (those fire for every clock in the database).
 */
import { createHmac, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  expect,
  type APIRequestContext,
  type Browser,
  type Locator,
  type Page,
  type PlaywrightWorkerArgs,
} from '@playwright/test'
import { fromUuid, generateId, toUuid } from '@quackback/ids'
import { pollFor, supportDb } from './db'
import { SUPPORT_RUN_DIR, supportEnv } from './env'
import { conversationReplyAddress, sendInboundEmail, supportInboxAddress } from './inbound-email'
import { emailLogFor, getMail, mailTo, type MailpitMessage } from './mailpit'
import { personStatePath, type SupportPersonName } from './people'
import { createSupportApiKey, setFeatureFlag } from '../utils/db-helpers'

type Playwright = PlaywrightWorkerArgs['playwright']

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

/** The uuid behind a TypeID (`conversation_01h...`). */
export function uuidOf(typeId: string): string {
  return toUuid(typeId as `conversation_${string}`)
}

export function conversationTypeId(uuid: string): string {
  return fromUuid('conversation', uuid)
}

// ---------------------------------------------------------------------------
// Server functions
// ---------------------------------------------------------------------------

const appDir = resolve(import.meta.dirname, '../..')

interface ManifestEntry {
  id: string
  functionName: string
  chunk: string
}

let manifest: ManifestEntry[] | null = null

function loadManifest(): ManifestEntry[] {
  if (manifest) return manifest
  const serverDir = resolve(appDir, '.output/server')
  const file = readdirSync(serverDir).find((f) =>
    f.startsWith('__23tanstack-start-server-fn-resolver-')
  )
  if (!file) throw new Error(`No server function manifest in ${serverDir}; build the app first`)
  const text = readFileSync(resolve(serverDir, file), 'utf8')
  const re =
    /"([0-9a-f_]+)": \{\s*functionName: "([^"]+)",\s*importer: \(\) => import\("\.\/_ssr\/([^"]+)"\)/g
  manifest = [...text.matchAll(re)].map((m) => ({ id: m[1], functionName: m[2], chunk: m[3] }))
  if (manifest.length === 0) throw new Error(`Could not parse the server function manifest ${file}`)
  return manifest
}

function serverFnId(name: string, sourceFile?: string): string {
  const matches = loadManifest().filter((e) => e.functionName === `${name}_createServerFn_handler`)
  const picked = sourceFile ? matches.filter((e) => e.chunk.startsWith(`${sourceFile}-`)) : matches
  if (picked.length !== 1) {
    throw new Error(
      `Server function ${name}: ${picked.length} matches (${matches.map((m) => m.chunk).join(', ')})`
    )
  }
  return picked[0].id
}

type Seroval = {
  toJSONAsync: (v: unknown, o?: unknown) => Promise<unknown>
  fromCrossJSON: (v: unknown, o: unknown) => unknown
}
let seroval: Promise<{ lib: Seroval; plugins: unknown[] }> | null = null

function packageDir(fromDir: string, name: string): string {
  let dir = fromDir
  for (;;) {
    const candidate = resolve(dir, 'node_modules', name)
    if (existsSync(resolve(candidate, 'package.json'))) return realpathSync(candidate)
    const parent = dirname(dir)
    if (parent === dir) throw new Error(`Cannot find ${name} from ${fromDir}`)
    dir = parent
  }
}

function esmEntry(dir: string): string {
  const pkg = JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8')) as {
    exports?: unknown
    module?: string
    main?: string
  }
  const pick = (node: unknown): string | undefined => {
    if (typeof node === 'string') return node
    if (node && typeof node === 'object') {
      const o = node as Record<string, unknown>
      return pick(o['.']) ?? pick(o.import) ?? pick(o.default) ?? pick(o.node)
    }
    return undefined
  }
  const entry = pick(pkg.exports) ?? pkg.module ?? pkg.main
  if (!entry) throw new Error(`No ESM entry in ${dir}`)
  return resolve(dir, entry)
}

// seroval (the wire format) is reached through @tanstack/react-start so the
// versions always match the app's. The router's default plugins only: the
// app's typed-error adapter is not loaded, so a thrown error is read from the
// raw wire text (it carries the code and message).
function loadSeroval() {
  seroval ??= (async () => {
    const startDir = packageDir(appDir, '@tanstack/react-start')
    const clientCoreDir = packageDir(startDir, '@tanstack/start-client-core')
    const serovalDir = packageDir(clientCoreDir, 'seroval')
    const routerCoreDir = packageDir(clientCoreDir, '@tanstack/router-core')
    const lib = (await import(pathToFileURL(esmEntry(serovalDir)).href)) as Seroval
    const ssrClient = (await import(
      pathToFileURL(resolve(routerCoreDir, 'dist/esm/ssr/client.js')).href
    )) as { createDefaultSerovalPlugins: () => unknown[] }
    return { lib, plugins: ssrClient.createDefaultSerovalPlugins() }
  })()
  return seroval
}

export interface FnResult<T = unknown> {
  status: number
  /** True when the function returned (no throw). */
  ok: boolean
  data: T
  /** A typed error's code (e.g. SLA_POLICY_NOT_FOUND), '' when ok or untyped. */
  code: string
  /** The raw answer when the call threw ('' when ok): carries the message. */
  error: string
}

type WireNode = {
  t?: number
  s?: unknown
  p?: { k: string[]; v: WireNode[] }
  [k: string]: unknown
}

function envelopeField(root: unknown, key: string): WireNode | undefined {
  const node = root as WireNode | undefined
  if (!node?.p?.k) return undefined
  const i = node.p.k.indexOf(key)
  return i === -1 ? undefined : node.p.v[i]
}

/** seroval writes `undefined` as the constant node { t: 2, s: 1 }. */
function isUndefinedNode(node: WireNode): boolean {
  return node.t === 2 && node.s === 1
}

/** The first string value under a property `key` anywhere in a wire node. */
function findStringField(node: unknown, key: string): string | undefined {
  if (!node || typeof node !== 'object') return undefined
  const n = node as WireNode
  if (n.p?.k) {
    const i = n.p.k.indexOf(key)
    const v = i === -1 ? undefined : n.p.v[i]
    if (v && v.t === 1 && typeof v.s === 'string') return v.s
  }
  for (const value of Object.values(n)) {
    const found = Array.isArray(value)
      ? value.map((x) => findStringField(x, key)).find(Boolean)
      : findStringField(value, key)
    if (found) return found
  }
  return undefined
}

/** Call a server function by name as whoever `api` is signed in as. */
export async function callFn<T = unknown>(
  api: APIRequestContext,
  name: string,
  data?: unknown,
  opts: { method?: 'POST' | 'GET'; sourceFile?: string } = {}
): Promise<FnResult<T>> {
  const { lib, plugins } = await loadSeroval()
  const id = serverFnId(name, opts.sourceFile)
  const payload = JSON.stringify(await lib.toJSONAsync({ data }, { plugins }))
  const baseUrl = supportEnv().baseUrl
  const headers = {
    'x-tsr-serverFn': 'true',
    accept: 'application/json',
    origin: baseUrl,
    referer: `${baseUrl}/admin`,
  }
  const res =
    opts.method === 'GET'
      ? await api.get(`/_serverFn/${id}?payload=${encodeURIComponent(payload)}`, { headers })
      : await api.post(`/_serverFn/${id}`, {
          headers: { ...headers, 'content-type': 'application/json' },
          data: payload,
        })
  const raw = await res.text()
  let json: unknown = undefined
  try {
    json = JSON.parse(raw)
  } catch {
    json = undefined
  }
  const errorNode = envelopeField(json, 'error')
  const thrown = res.status() >= 400 || (errorNode !== undefined && !isUndefinedNode(errorNode))
  let result: unknown = undefined
  if (!thrown) {
    const decoded = lib.fromCrossJSON(json, { refs: new Map(), plugins }) as { result?: unknown }
    result = decoded?.result
  }
  return {
    status: res.status(),
    ok: !thrown,
    data: result as T,
    code: thrown ? (findStringField(errorNode ?? json, 'code') ?? '') : '',
    error: thrown ? raw : '',
  }
}

/** `callFn` that must succeed; returns its value. */
export async function fnOk<T = unknown>(
  api: APIRequestContext,
  name: string,
  data?: unknown,
  opts: { method?: 'POST' | 'GET'; sourceFile?: string } = {}
): Promise<T> {
  const res = await callFn<T>(api, name, data, opts)
  expect(res.ok, `${name} failed: ${res.error}`).toBe(true)
  return res.data
}

/** A request context signed in as a suite person or a seeded one. */
export async function apiAs(
  playwright: Playwright,
  who: SupportPersonName | SeededPerson
): Promise<APIRequestContext> {
  return playwright.request.newContext({
    baseURL: supportEnv().baseUrl,
    storageState: typeof who === 'string' ? personStatePath(who) : who.statePath,
  })
}

const apiKeys = new Map<string, string>()

/**
 * A REST v1 client with an API key of the admin (or another teammate by
 * email). Keys are made once per worker: each make shells out to a script.
 */
export async function restAs(
  playwright: Playwright,
  kind: 'personal' | 'workspace' = 'personal',
  email = 'e2e-support-admin@example.com'
): Promise<APIRequestContext> {
  const cacheKey = `${email}:${kind}`
  let key = apiKeys.get(cacheKey)
  if (!key && kind === 'personal') key = createSupportApiKey(email, kind)
  if (!key) {
    // A workspace key holds a role: made by the admin through the settings function.
    const [role] = await supportDb()<{ id: string }[]>`SELECT id FROM roles WHERE key = 'admin'`
    const admin = await apiAs(playwright, 'admin')
    const made = await fnOk<{ plainTextKey: string }>(admin, 'createApiKeyFn', {
      name: `support e2e workspace key ${Date.now()}`,
      roleId: fromUuid('role', role.id),
    })
    await admin.dispose()
    key = made.plainTextKey
  }
  apiKeys.set(cacheKey, key)
  return playwright.request.newContext({
    baseURL: supportEnv().baseUrl,
    extraHTTPHeaders: { authorization: `Bearer ${key}` },
  })
}

/**
 * Click `trigger` until `opened` shows: a click that lands before the page has
 * hydrated does nothing, so one retry loop instead of a fixed wait.
 */
export async function clickUntil(trigger: Locator, opened: Locator, timeout = 20_000) {
  await expect(async () => {
    if (!(await opened.isVisible())) await trigger.click({ timeout: 2_000 })
    await expect(opened).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout })
}

/** A browser page signed in as a seeded person (close its context when done). */
export async function pageAs(browser: Browser, who: SeededPerson): Promise<Page> {
  const context = await browser.newContext({ storageState: who.statePath })
  return context.newPage()
}

// ---------------------------------------------------------------------------
// Fresh people and teams
// ---------------------------------------------------------------------------

export interface SeededPerson {
  email: string
  name: string
  userId: string
  /** TypeID */
  principalId: string
  principalUuid: string
  statePath: string
}

/** A fresh team, so "team members" is a set this test owns. */
export async function seedTeam(marker: string): Promise<{ id: string; uuid: string }> {
  const uuid = toUuid(generateId('team'))
  await supportDb()`INSERT INTO teams (id, name, description)
                    VALUES (${uuid}, ${`Team ${marker}`}, ${'support e2e'})`
  return { id: fromUuid('team', uuid), uuid }
}

/**
 * A fresh person with a minted session. `teammate` is a team member (role key
 * `support_lead` unless given, so they see every conversation); `customer` is a
 * portal user.
 */
export async function seedPerson(
  marker: string,
  kind: 'teammate' | 'customer',
  opts: { tag?: string; roleKey?: string; teamUuids?: string[]; name?: string } = {}
): Promise<SeededPerson> {
  const sql = supportDb()
  const tag = opts.tag ?? kind
  const email = `${marker}-${tag}@${kind === 'customer' ? 'customers' : 'team'}.example`
  const name = opts.name ?? `${kind === 'customer' ? 'Customer' : 'Teammate'} ${tag} ${marker}`
  const userUuid = toUuid(generateId('user'))
  const principalUuid = toUuid(generateId('principal'))
  await sql`INSERT INTO "user" (id, name, email, email_verified, created_at, updated_at)
            VALUES (${userUuid}, ${name}, ${email}, true, NOW(), NOW())`
  await sql`INSERT INTO principal (id, user_id, role, type, display_name, chat_availability, created_at)
            VALUES (${principalUuid}, ${userUuid}, ${kind === 'customer' ? 'user' : 'member'}, 'user',
                    ${name}, 'online', NOW())`
  if (kind === 'teammate') {
    const [role] = await sql`SELECT id FROM roles WHERE key = ${opts.roleKey ?? 'support_lead'}`
    if (!role) throw new Error(`Role not found: ${opts.roleKey}`)
    await sql`INSERT INTO principal_role_assignments (id, principal_id, role_id, created_at)
              VALUES (${toUuid(generateId('role_asgn'))}, ${principalUuid}, ${role.id as string}, NOW())`
    for (const teamUuid of opts.teamUuids ?? []) {
      await sql`INSERT INTO team_members (id, team_id, principal_id)
                VALUES (${toUuid(generateId('team_member'))}, ${teamUuid}, ${principalUuid})`
    }
  }
  // A session the way better-auth writes one (see mint-support-sessions.ts).
  const token = randomBytes(24).toString('base64url')
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
  await sql`INSERT INTO session (id, expires_at, token, created_at, updated_at, user_agent, scope, user_id)
            VALUES (${randomUUID()}, ${expiresAt}, ${token}, NOW(), NOW(), 'support-e2e', 'dashboard',
                    ${userUuid})`
  const env = supportEnv()
  const signature = createHmac('sha256', env.app.SECRET_KEY).update(token).digest('base64')
  const cookie = {
    value: encodeURIComponent(`${token}.${signature}`),
    domain: new URL(env.baseUrl).hostname,
    path: '/',
    expires: Math.floor(expiresAt.getTime() / 1000),
    httpOnly: true,
    sameSite: 'Lax' as const,
  }
  const statePath = resolve(SUPPORT_RUN_DIR, `seeded-${principalUuid}.json`)
  writeFileSync(
    statePath,
    JSON.stringify({
      cookies: [
        { ...cookie, name: 'better-auth.session_token', secure: false },
        { ...cookie, name: '__Secure-better-auth.session_token', secure: true },
      ],
      origins: [],
    })
  )
  return {
    email,
    name,
    userId: fromUuid('user', userUuid),
    principalId: fromUuid('principal', principalUuid),
    principalUuid,
    statePath,
  }
}

/**
 * Take a seeded teammate out of the team again (customer role, no teams), so
 * the teammates a run makes do not pile up as recipients of every later team
 * email in the database.
 */
export async function retireTeammate(person: SeededPerson): Promise<void> {
  const sql = supportDb()
  await sql`DELETE FROM team_members WHERE principal_id = ${person.principalUuid}`
  await sql`DELETE FROM principal_role_assignments WHERE principal_id = ${person.principalUuid}`
  await sql`UPDATE principal SET role = 'user' WHERE id = ${person.principalUuid}`
  await sql`DELETE FROM kv_store WHERE key = ${`principal:user:${person.userId}`}`
}

// ---------------------------------------------------------------------------
// Conversations through the real doors
// ---------------------------------------------------------------------------

export interface StartedConversation {
  /** TypeID */
  id: string
  uuid: string
  subject: string
  customerEmail: string
  visitorPrincipalUuid: string
}

/** The conversation whose first message has this Message-ID. */
async function conversationForMessageId(messageId: string): Promise<{
  id: string
  visitor_principal_id: string
}> {
  const bare = messageId.replace(/[<>]/g, '')
  return pollFor(
    `a conversation for ${messageId}`,
    async () => {
      const [row] = await supportDb()<{ id: string; visitor_principal_id: string }[]>`
        SELECT c.id, c.visitor_principal_id
        FROM conversation_messages m JOIN conversations c ON c.id = m.conversation_id
        WHERE m.metadata ->> 'emailMessageId' LIKE ${`%${bare}%`}
        LIMIT 1`
      return row ?? null
    },
    { timeoutMs: 15_000 }
  )
}

/** An Authentication-Results header with a DMARC pass for `from`'s domain. */
function dmarcPass(from: string): Record<string, string> {
  const domain = from.split('@')[1]
  return {
    'authentication-results': `mx.inbound.test; spf=pass smtp.mailfrom=${domain}; dkim=pass header.d=${domain}; dmarc=pass header.from=${domain}`,
  }
}

/**
 * Cold inbound email opens an email conversation. From `${marker}@customers.example`
 * (a lead with no account), or, with `customer`, from that seeded customer
 * with a DMARC pass, so the mail attaches to their account (person.email then
 * resolves, which workflow audiences need).
 */
export async function startEmailConversation(
  request: APIRequestContext,
  marker: string,
  opts: { customer?: SeededPerson; subject?: string; text?: string } = {}
): Promise<StartedConversation> {
  const from = opts.customer?.email ?? `${marker}@customers.example`
  const subject = opts.subject ?? `Help ${marker}`
  const messageId = `<${marker}-${randomUUID()}@customers.example>`
  const res = await sendInboundEmail(request, {
    from,
    to: supportInboxAddress(),
    subject,
    text: opts.text ?? `Hello, I need help with ${marker}.`,
    messageId,
    headers: opts.customer ? dmarcPass(from) : undefined,
  })
  expect(res.status(), await res.text()).toBe(200)
  const row = await conversationForMessageId(messageId)
  return {
    id: conversationTypeId(row.id),
    uuid: row.id,
    subject,
    customerEmail: from,
    visitorPrincipalUuid: row.visitor_principal_id,
  }
}

/** The customer writes again on an email conversation (a reply to its address). */
export async function customerEmailsAgain(
  request: APIRequestContext,
  conversation: StartedConversation,
  text: string
): Promise<void> {
  const res = await sendInboundEmail(request, {
    from: conversation.customerEmail,
    to: conversationReplyAddress(conversation.id),
    subject: `Re: ${conversation.subject}`,
    text,
    messageId: `<${randomUUID()}@customers.example>`,
    headers: dmarcPass(conversation.customerEmail),
  })
  expect(res.status(), await res.text()).toBe(200)
  expect(await res.json()).toMatchObject({ status: 'ingested' })
}

/**
 * A signed-in customer starts a messenger conversation from the portal (the
 * visitor's own send). Returns the new conversation.
 */
export async function startPortalConversation(
  customerApi: APIRequestContext,
  customer: SeededPerson,
  text: string
): Promise<StartedConversation> {
  const sent = await fnOk<{ conversation?: { id: string }; conversationId?: string }>(
    customerApi,
    'sendConversationMessageFn',
    { content: text }
  )
  const id = sent.conversation?.id ?? sent.conversationId
  expect(id, `sendConversationMessageFn answered ${JSON.stringify(sent)}`).toBeTruthy()
  return {
    id: id!,
    uuid: uuidOf(id!),
    subject: text,
    customerEmail: customer.email,
    visitorPrincipalUuid: customer.principalUuid,
  }
}

// ---------------------------------------------------------------------------
// Mail
// ---------------------------------------------------------------------------

/** Every message to `address`, in full, newest first. */
export async function fullMailTo(address: string): Promise<MailpitMessage[]> {
  return Promise.all((await mailTo(address)).map((m) => getMail(m.ID)))
}

/**
 * Wait for a message to `address` that matches. On a timeout the error lists
 * the app's email_log rows for the address, so a send that failed in transport
 * (e.g. SMTP "Greeting never received") reads differently from one never made.
 */
export async function waitForMailWhere(
  address: string,
  what: string,
  match: (m: MailpitMessage) => boolean,
  timeoutMs = 20_000
): Promise<MailpitMessage> {
  // Bodies are fetched once per message, so a long wait does not refetch the
  // whole mailbox on every poll.
  const seen = new Map<string, MailpitMessage>()
  try {
    return await pollFor(
      `${what} to ${address}`,
      async () => {
        for (const summary of await mailTo(address)) {
          if (!seen.has(summary.ID)) seen.set(summary.ID, await getMail(summary.ID))
          const full = seen.get(summary.ID)!
          if (match(full)) return full
        }
        return null
      },
      { timeoutMs, intervalMs: 300 }
    )
  } catch (err) {
    const rows = await emailLogFor(address)
    const log = rows
      .map((r) => `${r.email_type}/${r.status}${r.error ? ` (${r.error})` : ''}`)
      .join(', ')
    throw new Error(`${(err as Error).message}. email_log for the address: ${log || 'none'}`, {
      cause: err,
    })
  }
}

// ---------------------------------------------------------------------------
// Reading conversation state
// ---------------------------------------------------------------------------

export type SlaStamp = Record<string, unknown> & {
  policyId: string
  policyName: string
  appliedAt: string
}

export async function slaStampOf(conversationUuid: string): Promise<SlaStamp | null> {
  const [row] = await supportDb()<{ sla_applied: SlaStamp | null }[]>`
    SELECT sla_applied FROM conversations WHERE id = ${conversationUuid}`
  return row?.sla_applied ?? null
}

export async function ticketSlaStampOf(ticketUuid: string): Promise<SlaStamp | null> {
  const [row] = await supportDb()<{ sla_applied: SlaStamp | null }[]>`
    SELECT sla_applied FROM tickets WHERE id = ${ticketUuid}`
  return row?.sla_applied ?? null
}

/** Poll the conversation's stamp until `check` holds. */
export async function waitForStamp(
  conversationUuid: string,
  what: string,
  check: (stamp: SlaStamp) => boolean,
  timeoutMs = 20_000
): Promise<SlaStamp> {
  return pollFor(
    what,
    async () => {
      const stamp = await slaStampOf(conversationUuid)
      return stamp && check(stamp) ? stamp : null
    },
    { timeoutMs, intervalMs: 300 }
  )
}

export interface SlaEventRow {
  kind: string
  meta: Record<string, unknown>
  at: Date
  policy_id: string
}

export async function slaEventsFor(
  subject: { conversationUuid?: string; ticketUuid?: string },
  kind?: string
): Promise<SlaEventRow[]> {
  const sql = supportDb()
  const rows = subject.ticketUuid
    ? await sql<SlaEventRow[]>`SELECT kind, meta, at, policy_id FROM sla_events
                               WHERE ticket_id = ${subject.ticketUuid} ORDER BY at`
    : await sql<SlaEventRow[]>`SELECT kind, meta, at, policy_id FROM sla_events
                               WHERE conversation_id = ${subject.conversationUuid!}
                                 AND ticket_id IS NULL ORDER BY at`
  return kind ? rows.filter((r) => r.kind === kind) : rows
}

export async function waitForSlaEvent(
  subject: { conversationUuid?: string; ticketUuid?: string },
  kind: string,
  timeoutMs = 20_000
): Promise<SlaEventRow> {
  return pollFor(
    `sla_events ${kind} for ${JSON.stringify(subject)}`,
    async () => (await slaEventsFor(subject, kind))[0] ?? null,
    { timeoutMs, intervalMs: 300 }
  )
}

/** Move a stamp's due fields into the past (or anywhere): `{ firstResponseDueAt: date }`. */
/**
 * Move the workspace's first breach-sweep tick (slaBreachEventsSince,
 * workflow-sweep.ts) back to `iso` when it is later. The breach sweep never
 * fires for a clock due before that tick, so a journey that backdates a
 * deadline on a fresh database, whose first sweep has not run yet or ran after
 * that deadline, would otherwise never see the breach. Single-workspace jobs
 * run with no workspace scope, so the key lives in the `_` namespace.
 */
async function sweepingSinceAtMost(iso: string): Promise<void> {
  await supportDb()`
    INSERT INTO kv_store (workspace_key, key, value, expires_at)
    VALUES ('_', 'sla:breach-events-since', to_jsonb(${iso}::text), now() + interval '10 years')
    ON CONFLICT (workspace_key, key) DO UPDATE
      SET value = CASE
            WHEN kv_store.expires_at > now() AND (kv_store.value #>> '{}') <= ${iso}
            THEN kv_store.value ELSE EXCLUDED.value END,
          expires_at = EXCLUDED.expires_at`
}

export async function setStampFields(
  table: 'conversations' | 'tickets',
  uuid: string,
  fields: Record<string, string | null>
): Promise<void> {
  // A deadline moved into the past stands for history: the sweep was already
  // running then.
  const pastDeadlines = Object.entries(fields)
    .filter(([key, value]) => key.endsWith('DueAt') && value && value < new Date().toISOString())
    .map(([, value]) => value as string)
    .sort()
  if (pastDeadlines.length > 0) await sweepingSinceAtMost(pastDeadlines[0])
  const sql = supportDb()
  const patch = sql.json(fields)
  const rows =
    table === 'conversations'
      ? await sql`UPDATE conversations SET sla_applied = sla_applied || ${patch}
                  WHERE id = ${uuid} AND jsonb_typeof(sla_applied) = 'object' RETURNING id`
      : await sql`UPDATE tickets SET sla_applied = sla_applied || ${patch}
                  WHERE id = ${uuid} AND jsonb_typeof(sla_applied) = 'object' RETURNING id`
  expect(rows, `no SLA stamp to change on ${table} ${uuid}`).toHaveLength(1)
}

export function isoMinutesFromNow(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString()
}

// ---------------------------------------------------------------------------
// SLA policies
// ---------------------------------------------------------------------------

/** The shape every default policy in this suite has: four long targets, 24/7. */
export const DEFAULT_SLA_TARGETS = {
  firstResponseTargetSecs: 4 * 3600,
  nextResponseTargetSecs: 4 * 3600,
  timeToCloseTargetSecs: 24 * 3600,
  timeToResolveTargetSecs: 48 * 3600,
} as const

export const SUITE_DEFAULT_SLA_NAME = 'E2E default SLA'

export interface SlaPolicyDTO {
  id: string
  name: string
  firstResponseTargetSecs: number | null
  nextResponseTargetSecs: number | null
  timeToCloseTargetSecs: number | null
  timeToResolveTargetSecs: number | null
  pauseOnSnooze: boolean
  pauseOnPending: boolean
  archivedAt: string | null
  usedByWorkflows: { id: string; name: string; status: string }[]
}

/** A policy's targets as stored (for asserting a stamp against its own policy). */
export async function policyTargetsOf(policyId: string): Promise<{
  firstResponseTargetSecs: number | null
  nextResponseTargetSecs: number | null
  timeToCloseTargetSecs: number | null
  timeToResolveTargetSecs: number | null
}> {
  const [row] = await supportDb()<
    {
      first_response_target_secs: number | null
      next_response_target_secs: number | null
      time_to_close_target_secs: number | null
      time_to_resolve_target_secs: number | null
    }[]
  >`SELECT first_response_target_secs, next_response_target_secs, time_to_close_target_secs,
           time_to_resolve_target_secs
    FROM sla_policies WHERE id = ${toUuid(policyId as `sla_policy_${string}`)}`
  return {
    firstResponseTargetSecs: row.first_response_target_secs,
    nextResponseTargetSecs: row.next_response_target_secs,
    timeToCloseTargetSecs: row.time_to_close_target_secs,
    timeToResolveTargetSecs: row.time_to_resolve_target_secs,
  }
}

export async function createSlaPolicy(
  adminApi: APIRequestContext,
  input: Record<string, unknown>
): Promise<SlaPolicyDTO> {
  return fnOk<SlaPolicyDTO>(adminApi, 'createSlaPolicyFn', input)
}

/**
 * Make sure a default SLA policy is set. Only ever sets one when there is none,
 * so it never fights SLA-05 (which switches between policies of the same shape).
 */
export async function ensureDefaultSla(adminApi: APIRequestContext): Promise<void> {
  const current = await fnOk<{ policyId: string | null }>(
    adminApi,
    'fetchDefaultSlaPolicyFn',
    undefined,
    { method: 'GET' }
  )
  if (current.policyId) return
  const policies = await fnOk<SlaPolicyDTO[]>(adminApi, 'listSlaPoliciesFn', undefined, {
    method: 'GET',
  })
  const existing = policies.find((p) => p.name === SUITE_DEFAULT_SLA_NAME && !p.archivedAt)
  const policy =
    existing ??
    (await createSlaPolicy(adminApi, { name: SUITE_DEFAULT_SLA_NAME, ...DEFAULT_SLA_TARGETS }))
  await fnOk(adminApi, 'updateDefaultSlaPolicyFn', { policyId: policy.id })
}

// ---------------------------------------------------------------------------
// Workflows
// ---------------------------------------------------------------------------

export interface WorkflowNode {
  id: string
  type: string
  [key: string]: unknown
}

export interface WorkflowDef {
  name: string
  triggerType: string
  class?: 'customer_facing' | 'background'
  /** Extra trigger settings; the audience is added from `onlyFor`. */
  triggerSettings?: Record<string, unknown>
  /** The customer this workflow may run for (person.email). Always set one. */
  onlyFor: string
  /** More audience conditions, all of which must hold too. */
  alsoWhen?: Record<string, unknown>[]
  /** Steps after the trigger, run in order. */
  steps: WorkflowNode[]
}

/** A TipTap doc with one paragraph. */
export function textDoc(text: string): Record<string, unknown> {
  return { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] }
}

/** Every workflow these specs make is named with this, so leftovers can be found. */
export const WORKFLOW_PREFIX = 'e2e-4b '

export async function createWorkflow(
  adminApi: APIRequestContext,
  def: WorkflowDef
): Promise<{ id: string; name: string }> {
  const nodes = [{ id: 'trigger', type: 'trigger' }, ...def.steps]
  const edges = nodes.slice(1).map((n, i) => ({ from: nodes[i].id, to: n.id }))
  return fnOk<{ id: string; name: string }>(adminApi, 'createWorkflowFn', {
    name: `${WORKFLOW_PREFIX}${def.name}`,
    class: def.class ?? 'background',
    triggerType: def.triggerType,
    triggerSettings: {
      ...def.triggerSettings,
      audience: {
        all: [{ field: 'person.email', op: 'eq', value: def.onlyFor }, ...(def.alsoWhen ?? [])],
      },
    },
    graph: { nodes, edges },
  })
}

export async function takeDownWorkflow(adminApi: APIRequestContext, id: string): Promise<void> {
  await callFn(adminApi, 'setWorkflowStatusFn', { id, status: 'paused' })
  await callFn(adminApi, 'deleteWorkflowFn', { id })
}

/** Publish a workflow for the duration of `run`; it is always taken down. */
export async function withLiveWorkflow<T>(
  adminApi: APIRequestContext,
  def: WorkflowDef,
  run: (workflow: { id: string; name: string }) => Promise<T>
): Promise<T> {
  const workflow = await createWorkflow(adminApi, def)
  try {
    await fnOk(adminApi, 'setWorkflowStatusFn', { id: workflow.id, status: 'live' })
    return await run(workflow)
  } finally {
    await takeDownWorkflow(adminApi, workflow.id)
  }
}

/** A workflow's runs (by workflow TypeID) with their state. */
export async function workflowRuns(
  workflowId: string
): Promise<{ id: string; state: string; conversation_id: string }[]> {
  return supportDb()<{ id: string; state: string; conversation_id: string }[]>`
    SELECT id, state, conversation_id FROM workflow_runs
    WHERE workflow_id = ${toUuid(workflowId as `workflow_${string}`)}`
}

/**
 * Serialise the tests that publish `sla.approaching_breach` / `sla.breached`
 * workflows: while one is live the workflow sweep fires for every clock in the
 * database inside the lead window, so no two may overlap (in any file or
 * worker of this database). A session advisory lock on its own connection.
 */
export async function withSlaTimerLock<T>(
  adminApi: APIRequestContext,
  run: () => Promise<T>
): Promise<T> {
  const reserved = await supportDb().reserve()
  const key = 4_2024_1119
  try {
    await reserved`SELECT pg_advisory_lock(${key})`
    // A run that timed out inside withLiveWorkflow can leave its timer
    // workflow live; take any such leftover down before relying on "none".
    const live = await supportDb()<{ id: string }[]>`
      SELECT id FROM workflows
      WHERE name LIKE ${`${WORKFLOW_PREFIX}%`} AND status = 'live'
        AND trigger_type IN ('sla.approaching_breach', 'sla.breached')`
    for (const row of live) await takeDownWorkflow(adminApi, fromUuid('workflow', row.id))
    return await run()
  } finally {
    await reserved`SELECT pg_advisory_unlock(${key})`.catch(() => undefined)
    reserved.release()
  }
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------

let supportTicketsOn = false

/**
 * Customer tickets (portal filing, ticket emails) need the `supportTickets`
 * flag. Only ever turned on, once per worker, and then confirmed through a
 * flag-gated function: a settings read racing the flag write can re-cache the
 * old value, so the flag is written (and the cache busted) again until the app
 * sees it.
 */
export async function ensureSupportTickets(playwright: Playwright): Promise<void> {
  if (supportTicketsOn) return
  const customer = await apiAs(playwright, 'customer')
  try {
    await expect(async () => {
      setFeatureFlag('supportTickets', true)
      const res = await callFn(customer, 'getMyTicketsFn', undefined, { method: 'GET' })
      expect(res.ok, res.error).toBe(true)
    }).toPass({ timeout: 30_000, intervals: [500, 1000, 2000] })
  } finally {
    await customer.dispose()
  }
  supportTicketsOn = true
}

export interface TicketStatusRow {
  id: string
  name: string
  category: string
}

/** A ticket status by category (`open`, `pending`, `closed`), as a TypeID. */
export async function ticketStatusId(category: 'open' | 'pending' | 'closed'): Promise<string> {
  const [row] = await supportDb()<{ id: string }[]>`
    SELECT id FROM ticket_statuses WHERE category = ${category} AND deleted_at IS NULL
    ORDER BY is_default DESC, position ASC LIMIT 1`
  if (!row) throw new Error(`No ${category} ticket status`)
  return fromUuid('ticket_status', row.id)
}

export async function ticketRow(ticketUuid: string): Promise<{
  number: string
  status_id: string
  resolved_at: Date | null
  sla_applied: SlaStamp | null
}> {
  const [row] = await supportDb()<
    { number: string; status_id: string; resolved_at: Date | null; sla_applied: SlaStamp | null }[]
  >`SELECT number, status_id, resolved_at, sla_applied FROM tickets WHERE id = ${ticketUuid}`
  return row
}

/** The customer ticket linked to a conversation, once there is one. */
export async function linkedTicketUuid(conversationUuid: string, timeoutMs = 15_000) {
  return pollFor(
    `a ticket linked to ${conversationUuid}`,
    async () => {
      const [row] = await supportDb()<{ ticket_id: string }[]>`
        SELECT ticket_id FROM ticket_conversations WHERE conversation_id = ${conversationUuid} LIMIT 1`
      return row?.ticket_id ?? null
    },
    { timeoutMs }
  )
}

/** The backing conversation of a customer ticket. */
export async function ticketConversationUuid(ticketUuid: string, timeoutMs = 15_000) {
  return pollFor(
    `the conversation of ticket ${ticketUuid}`,
    async () => {
      const [row] = await supportDb()<{ conversation_id: string }[]>`
        SELECT conversation_id FROM ticket_conversations WHERE ticket_id = ${ticketUuid} LIMIT 1`
      return row?.conversation_id ?? null
    },
    { timeoutMs }
  )
}

// ---------------------------------------------------------------------------
// Ratings
// ---------------------------------------------------------------------------

export async function csatOf(conversationUuid: string): Promise<{
  csat_rating: number | null
  csat_comment: string | null
  csat_submitted_at: Date | null
  status: string
}> {
  const [row] = await supportDb()<
    {
      csat_rating: number | null
      csat_comment: string | null
      csat_submitted_at: Date | null
      status: string
    }[]
  >`SELECT csat_rating, csat_comment, csat_submitted_at, status FROM conversations
    WHERE id = ${conversationUuid}`
  return row
}

export async function waitForRating(conversationUuid: string, timeoutMs = 15_000) {
  return pollFor(
    `a rating on ${conversationUuid}`,
    async () => {
      const row = await csatOf(conversationUuid)
      return row.csat_rating != null ? row : null
    },
    { timeoutMs }
  )
}

/** Messages of a conversation, oldest first. */
export async function messagesOf(conversationUuid: string): Promise<
  {
    id: string
    sender_type: string
    content: string
    is_internal: boolean
    metadata: Record<string, unknown> | null
  }[]
> {
  return supportDb()<
    {
      id: string
      sender_type: string
      content: string
      is_internal: boolean
      metadata: Record<string, unknown> | null
    }[]
  >`SELECT id, sender_type, content, is_internal, metadata FROM conversation_messages
    WHERE conversation_id = ${conversationUuid} ORDER BY created_at, id`
}

/** Domain events the app recorded (the `events` table) of `type` for an entity. */
export async function eventsFor(
  type: string,
  entityId: string
): Promise<{ type: string; payload: Record<string, unknown>; actor_type: string }[]> {
  return supportDb()<{ type: string; payload: Record<string, unknown>; actor_type: string }[]>`
    SELECT type, payload, actor_type FROM events
    WHERE type = ${type} AND (entity_id = ${entityId} OR payload::text LIKE ${`%${entityId}%`})
    ORDER BY id`
}

/**
 * Mint a /csat token the way the app does (csat-email-token.ts): the same
 * HMAC over `csat-email:v1\n{conversationId}.{principalId}.{exp}` with the
 * suite's SECRET_KEY. `ttlMs` may be negative for an expired token.
 */
export function mintCsatToken(conversationId: string, principalId: string, ttlMs = 3_600_000) {
  const payload = `${conversationId}.${principalId}.${Date.now() + ttlMs}`
  const sig = createHmac('sha256', supportEnv().app.SECRET_KEY)
    .update(`csat-email:v1\n${payload}`)
    .digest('base64url')
  return `${Buffer.from(payload).toString('base64url')}.${sig}`
}
