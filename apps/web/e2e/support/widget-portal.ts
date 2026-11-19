/**
 * Helpers for the customer side of support: the widget messenger and the
 * portal Support tab (tests/support/widget-chat*.spec.ts,
 * portal-support*.spec.ts).
 *
 * - `callServerFn` calls a TanStack server function the way the client does
 *   (production function id = sha256 of `<file>--<name>_createServerFn_handler`,
 *   seroval-encoded payload), so api journeys hit the real widget/portal
 *   endpoints with a visitor's Bearer token or a portal cookie.
 * - `mintCustomer` / `mintSessionToken` / `portalPage` make a fresh customer
 *   with their own session, so a test never shares a customer with another
 *   test and never spends the per-IP identify or anonymous-mint budget.
 * - `openWidget` serves a host page that loads the real SDK, optionally
 *   identified with an ssoToken signed for a fresh customer.
 * - `agentApi` performs teammate actions (reply, note, status, assign)
 *   through the public REST API as the suite admin, for preconditions.
 */
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { fromUuid, generateId, toUuid } from '@quackback/ids'
import {
  expect,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test'
import { supportDb, pollFor } from './db'
import { supportEnv } from './env'
import { createSupportApiKey } from '../utils/db-helpers'
import { SUPPORT_PEOPLE } from './people'

// ---------------------------------------------------------------------------
// Server functions
// ---------------------------------------------------------------------------

interface Seroval {
  toJSONAsync: (value: unknown, opts?: unknown) => Promise<unknown>
  fromCrossJSON: (value: unknown, opts?: unknown) => unknown
  plugins: unknown[]
}

let seroval: Seroval | null = null
/**
 * The same seroval and plugins the browser uses (the router's defaults plus
 * the app's typed-error adapter, mirrored from
 * src/lib/shared/typed-error-serialization.ts). seroval and router-core are
 * dependencies of the start client, not of apps/web: reach them through it.
 */
function loadSeroval(): Seroval {
  if (seroval) return seroval
  const fromWeb = createRequire(resolve(process.cwd(), 'package.json'))
  const router = createRequire(fromWeb.resolve('@tanstack/react-router/package.json'))
  const core = createRequire(router.resolve('@tanstack/router-core/package.json'))
  const ssr = core('@tanstack/router-core/ssr/client') as {
    createDefaultSerovalPlugins: () => unknown[]
    makeSerovalPlugin: (adapter: unknown) => unknown
  }
  const lib = core('seroval') as Omit<Seroval, 'plugins'>
  const typedError = ssr.makeSerovalPlugin({
    key: 'quackback-typed-error',
    test: () => false,
    toSerializable: (v: unknown) => v,
    fromSerializable: (wire: { name: string; code: string; statusCode: number; message: string }) =>
      Object.assign(new Error(wire.message), {
        name: wire.name,
        code: wire.code,
        statusCode: wire.statusCode,
      }),
  })
  seroval = { ...lib, plugins: [typedError, ...ssr.createDefaultSerovalPlugins()] }
  return seroval
}

/** Source files of the server functions the customer surfaces call. */
export const FN_FILES = {
  widgetConversation: 'src/lib/server/functions/widget/conversation.ts',
  widgetTickets: 'src/lib/server/functions/widget/tickets.ts',
  conversation: 'src/lib/server/functions/conversation.ts',
  tickets: 'src/lib/server/functions/tickets.ts',
  portalSessionToken: 'src/lib/server/functions/portal-session-token.ts',
} as const

/** The production id the build gives a server function. */
export function serverFnId(file: string, name: string): string {
  return createHash('sha256').update(`${file}--${name}_createServerFn_handler`).digest('hex')
}

export interface ServerFnError {
  name?: string
  message: string
  code?: string
  status?: number
  [key: string]: unknown
}

export interface ServerFnResult<T = unknown> {
  /** HTTP status of the call. */
  status: number
  /** The function's return value when it did not throw. */
  value: T | undefined
  /** What the function threw, when it threw. */
  error: ServerFnError | undefined
}

export interface ServerFnCall {
  method?: 'GET' | 'POST'
  data?: unknown
  /** Widget visitor credential (`Authorization: Bearer`). */
  bearer?: string
  headers?: Record<string, string>
}

/**
 * Call a server function by file and export name. Throws if the build does
 * not know the function (a wrong file or name must fail loudly, never look
 * like a product refusal).
 */
export async function callServerFn<T = unknown>(
  request: APIRequestContext,
  file: string,
  name: string,
  call: ServerFnCall = {}
): Promise<ServerFnResult<T>> {
  const { toJSONAsync, fromCrossJSON, plugins } = loadSeroval()
  const method = call.method ?? 'POST'
  const id = serverFnId(file, name)
  const headers: Record<string, string> = {
    'x-tsr-serverFn': 'true',
    accept: 'application/json',
    // Same-origin, as the app's own pages call it (the CSRF guard checks this).
    origin: supportEnv().baseUrl,
    'sec-fetch-site': 'same-origin',
    ...(call.bearer ? { authorization: `Bearer ${call.bearer}` } : {}),
    ...call.headers,
  }
  const payload =
    call.data === undefined
      ? undefined
      : JSON.stringify(await toJSONAsync({ data: call.data }, { plugins }))
  let url = `/_serverFn/${id}`
  let body: string | undefined
  if (method === 'GET') {
    if (payload) url += `?${new URLSearchParams({ payload }).toString()}`
  } else {
    body = payload
    if (body) headers['content-type'] = 'application/json'
  }
  const res = await request.fetch(url, { method, headers, data: body, failOnStatusCode: false })
  const text = await res.text()
  if (!res.headers()['x-tss-serialized']) {
    throw new Error(
      `server fn ${name} (${file}) did not answer as a server function: ${res.status()} ${text.slice(0, 200)}`
    )
  }
  const envelope = fromCrossJSON(JSON.parse(text), { plugins, refs: new Map() }) as
    Error | { result?: unknown; error?: unknown }
  // A raw thrown error, or the framework's { result, error } envelope.
  const decoded =
    envelope instanceof Error
      ? envelope
      : envelope.error !== undefined && envelope.error !== null
        ? envelope.error
        : envelope.result
  if (decoded instanceof Error) {
    const e = decoded as Error & Record<string, unknown>
    const extra: Record<string, unknown> = {}
    for (const key of Object.keys(e)) extra[key] = e[key]
    return {
      status: res.status(),
      value: undefined,
      error: { ...extra, name: e.name, message: e.message } as ServerFnError,
    }
  }
  // Some refusals are returned as an error-shaped value rather than thrown.
  return { status: res.status(), value: decoded as T, error: undefined }
}

// ---------------------------------------------------------------------------
// Customers and sessions
// ---------------------------------------------------------------------------

export interface MintedCustomer {
  email: string
  name: string
  /** TypeIDs. */
  userId: string
  principalId: string
  /** Raw uuids for SQL. */
  userUuid: string
  principalUuid: string
}

/**
 * A fresh identified customer (user + principal), nobody else's. With
 * `anonymous` it is an anonymous widget visitor shaped like the anonymous
 * plugin makes one (temp-<id>@anon, principal type anonymous).
 */
export async function mintCustomer(opts: {
  email?: string
  name?: string
  anonymous?: boolean
  externalId?: string
}): Promise<MintedCustomer> {
  const sql = supportDb()
  const userUuid = toUuid(generateId('user'))
  const principalUuid = toUuid(generateId('principal'))
  const email = opts.anonymous ? `temp-${userUuid}@anon` : opts.email
  if (!email) throw new Error('mintCustomer needs an email or anonymous')
  const name =
    opts.name ?? (opts.anonymous ? 'Visitor' : `Customer ${email.split('@')[0].slice(-10)}`)
  await sql`INSERT INTO "user" (id, name, email, email_verified, is_anonymous, external_id, created_at, updated_at)
            VALUES (${userUuid}, ${name}, ${email}, ${!opts.anonymous}, ${!!opts.anonymous},
                    ${opts.externalId ?? null}, NOW(), NOW())`
  await sql`INSERT INTO principal (id, user_id, role, type, display_name, created_at)
            VALUES (${principalUuid}, ${userUuid}, 'user', ${opts.anonymous ? 'anonymous' : 'user'},
                    ${name}, NOW())`
  return {
    email,
    name,
    userId: fromUuid('user', userUuid),
    principalId: fromUuid('principal', principalUuid),
    userUuid,
    principalUuid,
  }
}

/** Insert a session row for a user; returns the raw token (a widget Bearer). */
export async function mintSessionToken(userUuid: string): Promise<string> {
  const token = randomBytes(24).toString('base64url')
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000)
  await supportDb()`INSERT INTO session (id, expires_at, token, created_at, updated_at, user_agent, scope, user_id)
            VALUES (${randomUUID()}, ${expiresAt}, ${token}, NOW(), NOW(), 'support-e2e', 'dashboard', ${userUuid})`
  return token
}

/** A browser context signed in to the portal as this customer. */
export async function portalContext(
  browser: Browser,
  customer: Pick<MintedCustomer, 'userUuid'>
): Promise<BrowserContext> {
  const env = supportEnv()
  const token = await mintSessionToken(customer.userUuid)
  const signature = createHmac('sha256', env.app.SECRET_KEY).update(token).digest('base64')
  const value = encodeURIComponent(`${token}.${signature}`)
  const domain = new URL(env.baseUrl).hostname
  const context = await browser.newContext({ baseURL: env.baseUrl })
  await context.addCookies([
    { name: 'better-auth.session_token', value, domain, path: '/', httpOnly: true, secure: false },
  ])
  return context
}

/** A page signed in to the portal as this customer. */
export async function portalPage(
  browser: Browser,
  customer: Pick<MintedCustomer, 'userUuid'>
): Promise<Page> {
  return (await portalContext(browser, customer)).newPage()
}

/** The workspace's widget secret (minted on first use by the harness page). */
export async function widgetSecret(request: APIRequestContext): Promise<string> {
  const read = async () =>
    (await supportDb()`SELECT widget_secret FROM settings LIMIT 1`)[0]?.widget_secret as
      string | null
  let secret = await read()
  if (!secret) {
    const res = await request.get('/e2e/widget?persona=customer')
    if (!res.ok()) throw new Error(`widget harness page answered ${res.status()}`)
    secret = await read()
  }
  if (!secret) throw new Error('no widget secret')
  return secret
}

function b64url(value: string): string {
  return Buffer.from(value).toString('base64url')
}

/** An ssoToken signed like a customer backend signs one (HS256, widget secret). */
export function signSsoToken(
  claims: { id?: string; email: string; name?: string; [k: string]: unknown },
  secret: string,
  expiresInSeconds = 600
): string {
  const now = Math.floor(Date.now() / 1000)
  const payload = {
    sub: claims.id ?? claims.email,
    id: claims.id ?? claims.email,
    iat: now,
    exp: now + expiresInSeconds,
    ...claims,
  }
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')
  return `${head}.${body}.${sig}`
}

// ---------------------------------------------------------------------------
// The widget in a browser
// ---------------------------------------------------------------------------

/** Clear the per-IP identify budget (every test client shares 127.0.0.1). */
export async function resetIdentifyBudget(): Promise<void> {
  await supportDb()`DELETE FROM rate_bucket WHERE key LIKE 'widget:identify:ip:%'`
}

/**
 * Open a host page that loads the real SDK and opens the widget. With
 * `ssoToken` the visitor is identified (the SDK's identify call). With
 * `visitorToken` the widget starts with that anonymous session already
 * persisted (as a returning visitor's browser holds it), so no anonymous
 * session is minted. With neither, the widget mints one lazily on first
 * write. Returns the widget iframe.
 */
export async function openWidget(
  page: Page,
  opts: { ssoToken?: string; visitorToken?: string } = {}
) {
  const env = supportEnv()
  const path = `/e2e/host-${randomBytes(6).toString('hex')}`
  if (opts.visitorToken) {
    await page.addInitScript(
      ({ origin, token }) => {
        if (window.location.origin !== origin || !window.location.pathname.startsWith('/widget'))
          return
        const key = `quackback:anon-token:${origin}`
        if (!window.localStorage.getItem(key)) {
          window.localStorage.setItem(
            key,
            JSON.stringify({ token, expiresAt: Date.now() + 24 * 60 * 60 * 1000 })
          )
        }
      },
      { origin: new URL(env.baseUrl).origin, token: opts.visitorToken }
    )
  }
  if (opts.ssoToken) await resetIdentifyBudget()
  const init = {
    instanceUrl: env.baseUrl,
    ...(opts.ssoToken ? { identity: { ssoToken: opts.ssoToken } } : {}),
  }
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>host</title></head>
<body><h1>Widget host</h1>
<script src="/api/widget/sdk.js"></script>
<script>
  (function () {
    var Q = window.Quackback
    Q('on', 'identify', function (ev) {
      document.documentElement.dataset.identified = ev && ev.success ? '1' : '0'
    })
    Q('init', ${JSON.stringify(init)})
    Q('open')
  })()
</script></body></html>`
  await page.route(`${env.baseUrl}${path}`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
  )
  await page.goto(path)
  if (opts.ssoToken) {
    await pollFor(
      'the widget identify to succeed',
      async () =>
        (await page.locator('html').getAttribute('data-identified')) === '1' ? true : null,
      { timeoutMs: 20_000 }
    )
  }
  return page.frameLocator('iframe.quackback-widget-iframe')
}

// ---------------------------------------------------------------------------
// Teammate actions through the REST API
// ---------------------------------------------------------------------------

let adminKey: string | null = null
function adminApiKey(): string {
  adminKey ??= createSupportApiKey(SUPPORT_PEOPLE.admin.email, 'personal')
  return adminKey
}

export function agentApi(request: APIRequestContext) {
  const headers = () => ({ authorization: `Bearer ${adminApiKey()}` })
  const post = async (path: string, data: unknown) => {
    const res = await request.post(`/api/v1${path}`, { headers: headers(), data })
    if (!res.ok()) throw new Error(`POST ${path} answered ${res.status()}: ${await res.text()}`)
    return res.json() as Promise<{ data: Record<string, unknown> }>
  }
  return {
    reply: (conversationId: string, content: string) =>
      post(`/conversations/${conversationId}/reply`, { content }),
    note: (conversationId: string, content: string) =>
      post(`/conversations/${conversationId}/note`, { content }),
    status: (conversationId: string, status: 'open' | 'closed' | 'snoozed') =>
      post(`/conversations/${conversationId}/status`, { status }),
    assign: (conversationId: string, assigneePrincipalId: string | null) =>
      post(`/conversations/${conversationId}/assign`, { assigneePrincipalId }),
    ticketStatus: (ticketId: string, body: Record<string, unknown>) =>
      post(`/tickets/${ticketId}/status`, body),
    ticketReply: (ticketId: string, content: string) =>
      post(`/tickets/${ticketId}/reply`, { content }),
    ticketNote: (ticketId: string, content: string) =>
      post(`/tickets/${ticketId}/note`, { content }),
  }
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface ConversationRow {
  id: string
  typeId: string
  status: string
  channel: string
  subject: string | null
  visitor_principal_id: string
  assigned_agent_principal_id: string | null
  [key: string]: unknown
}

/** The newest conversation whose messages contain `text`. */
export async function conversationWithMessage(text: string): Promise<ConversationRow> {
  return pollFor(`a conversation with message "${text}"`, async () => {
    const rows = await supportDb()`
      SELECT c.* FROM conversations c
      WHERE EXISTS (SELECT 1 FROM conversation_messages m
                    WHERE m.conversation_id = c.id AND m.content LIKE ${'%' + text + '%'})
      ORDER BY c.created_at DESC LIMIT 1`
    const row = rows[0]
    if (!row) return null
    return { ...row, typeId: fromUuid('conversation', row.id as string) } as ConversationRow
  })
}

/** Call one of the widget's conversation server functions. */
export function widgetFn<T = unknown>(
  request: APIRequestContext,
  name: string,
  call: ServerFnCall = {}
): Promise<ServerFnResult<T>> {
  const method = call.method ?? (/^widget(Get|List|Mint)/.test(name) ? 'GET' : 'POST')
  return callServerFn<T>(request, FN_FILES.widgetConversation, name, { ...call, method })
}

/** Messages (any kind) in a conversation. */
export async function messageCount(conversationTypeId: string): Promise<number> {
  const [row] = await supportDb()`SELECT count(*)::int AS n FROM conversation_messages
    WHERE conversation_id = ${toUuid(conversationTypeId as `conversation_${string}`)}`
  return row.n as number
}

/** Conversations a principal (uuid) owns as the visitor. */
export async function conversationCount(principalUuid: string): Promise<number> {
  const [row] = await supportDb()`SELECT count(*)::int AS n FROM conversations
    WHERE visitor_principal_id = ${principalUuid}`
  return row.n as number
}

/**
 * Open the live stream and report its status and content type, then hang up.
 * (An accepted stream never ends on its own, so it cannot go through
 * Playwright's request context.)
 */
export async function streamStatus(
  query: string,
  headers: Record<string, string> = {}
): Promise<{ status: number; contentType: string | null; body: string }> {
  const controller = new AbortController()
  const res = await fetch(`${supportEnv().baseUrl}/api/chat/stream?${query}`, {
    headers,
    signal: controller.signal,
  })
  const contentType = res.headers.get('content-type')
  const body = res.ok ? '' : await res.text()
  controller.abort()
  return { status: res.status, contentType, body }
}

/** A conversation row by TypeID. */
export async function conversationRow(typeId: string): Promise<ConversationRow> {
  const rows =
    await supportDb()`SELECT * FROM conversations WHERE id = ${toUuid(typeId as `conversation_${string}`)}`
  if (!rows[0]) throw new Error(`no conversation ${typeId}`)
  return { ...rows[0], typeId } as ConversationRow
}

// ---------------------------------------------------------------------------
// Widget conversations
// ---------------------------------------------------------------------------

/** A fresh visitor (anonymous unless given an email) with a widget session token. */
export async function mintVisitor(
  opts: { email?: string; name?: string } = {}
): Promise<MintedCustomer & { token: string }> {
  const customer = await mintCustomer({ anonymous: !opts.email, ...opts })
  return { ...customer, token: await mintSessionToken(customer.userUuid) }
}

interface SendResult {
  conversation: { id: string; status: string }
  message: { id: string }
}

/** Visitor sends a message through the widget endpoint (new conversation when no id). */
export async function visitorSend(
  request: APIRequestContext,
  token: string,
  content: string,
  conversationId?: string
): Promise<SendResult> {
  const res = await callServerFn<SendResult>(
    request,
    FN_FILES.widgetConversation,
    'widgetSendConversationMessageFn',
    { bearer: token, data: { content, ...(conversationId ? { conversationId } : {}) } }
  )
  if (res.error || !res.value) throw new Error(`visitor send failed: ${JSON.stringify(res.error)}`)
  return res.value
}

type Frame = ReturnType<Page['frameLocator']>

/** A widget bottom-bar tab; its name carries an unread prefix when badged. */
export function widgetTab(widget: Frame, label: 'Messages' | 'Tickets' | 'Home' | 'Help') {
  return widget.getByRole('button', { name: new RegExp(`^(?:\\d+ unread )?${label}$`) })
}

/** Open the visitor's thread whose list row shows `preview`. */
export async function openWidgetThread(widget: Frame, preview: string | RegExp) {
  await widgetTab(widget, 'Messages').click()
  await widget
    .getByRole('button', {
      name: typeof preview === 'string' ? new RegExp(escapeRegExp(preview)) : preview,
    })
    .first()
    .click()
}

/** The widget/portal composer editor. */
export function composer(scope: Frame | Page) {
  return scope.locator('.ProseMirror[contenteditable="true"]')
}

/** Type into the visitor composer and press Send. */
export async function visitorType(scope: Frame | Page, text: string) {
  const editor = composer(scope)
  await editor.click()
  await editor.fill(text)
  await scope.getByRole('button', { name: 'Send', exact: true }).click()
}

/**
 * Teammate writes in the open inbox thread: a public reply or an internal
 * note (Reply vs Note is a composer dropdown). Retries the first click, which
 * can land before the page hydrates.
 */
export async function inboxWrite(admin: Page, mode: 'Reply' | 'Note', text: string) {
  const other = mode === 'Reply' ? 'Note' : 'Reply'
  const trigger = admin.getByRole('button', { name: /^(Reply|Note)$/ })
  await expect(trigger).toBeVisible({ timeout: 15_000 })
  if ((await trigger.textContent())?.trim() !== mode) {
    await expect(async () => {
      await admin.getByRole('button', { name: other, exact: true }).click()
      await admin.getByRole('menuitemradio', { name: mode }).click({ timeout: 2_000 })
    }).toPass({ timeout: 15_000 })
  }
  await composer(admin).click()
  await composer(admin).fill(text)
  await admin.getByRole('button', { name: mode === 'Reply' ? 'Send reply' : 'Add note' }).click()
  await expect(admin.getByText(text).first()).toBeVisible({ timeout: 10_000 })
}

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
