/**
 * The provider fake: one local server standing in for the chat and
 * issue-tracker providers (Slack, Discord, Linear, GitHub, Jira) in the
 * product e2e suite. The app reaches it through E2E_PROVIDER_FAKE_URL, which
 * the app honours only behind the e2e harness gate
 * (src/lib/server/e2e-harness/provider-fake.ts): a request the app addresses
 * to `https://<provider host>/<path>` arrives here as `/<provider host>/<path>`.
 * The Slack SDK is pointed here the same way (`slackApiUrl`).
 *
 * With no rule, every request gets a plausible success for its provider
 * (Slack `{ ok: true, ... }`, a Linear `issueCreate`, a GitHub issue, ...),
 * so a connect or a delivery works out of the box.
 *
 * Control API (tests, via e2e/support/fake-provider-client.ts):
 *   POST   /__fake/rules              add a rule (see FakeProviderRule)
 *   DELETE /__fake/rules?marker=...   drop the rules for one marker
 *   GET    /__fake/requests?contains=...&host=...
 *   GET    /__fake/health
 *
 * A rule is keyed on a MARKER: text the test controls that appears in the
 * request (a post title, a channel or team id, an access token, a path). The
 * newest matching rule wins, so parallel tests never see each other's rules.
 *
 * Run: bun e2e/support/stand-ins/fake-provider.ts   (port from support.env)
 */
import { supportEnv } from '../env'

export interface FakeProviderRule {
  /** Text that must appear in the request: path, query, body or Authorization header. */
  marker: string
  /** Only requests to this provider host (e.g. `api.linear.app`). */
  host?: string
  /** Answer with this status (default 200). */
  status?: number
  /** Answer with this JSON body. */
  json?: unknown
  /** Answer with this text body (when `json` is not set). */
  text?: string
  /** Extra response headers, e.g. `{ 'retry-after': '30' }`. */
  headers?: Record<string, string>
  /** Wait this long before answering. */
  delayMs?: number
  /** Use the rule at most this many times, then fall through. */
  times?: number
}

export interface RecordedProviderRequest {
  seq: number
  at: string
  /** The provider host the app addressed (first path segment). */
  host: string
  method: string
  /** The provider path, without the host prefix. */
  path: string
  query: string
  headers: Record<string, string>
  body: string
  /** The body parsed as JSON, or form-decoded (Slack), or null. */
  json: unknown
  /** What markers are matched against. */
  text: string
  /** The marker of the rule that answered, or null. */
  matched: string | null
  status: number
}

const MAX_RECORDED = 2_000

interface StoredRule extends FakeProviderRule {
  uses: number
}

function parseBody(body: string, contentType: string): unknown {
  if (!body) return null
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(body))
  }
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

/** The text a marker is matched against: decoded, so form bodies match too. */
function matchText(method: string, path: string, query: string, body: string, auth: string) {
  let decoded = body
  try {
    decoded = decodeURIComponent(body.replace(/\+/g, ' '))
  } catch {
    // keep the raw body
  }
  return [`${method} ${path}${query}`, decoded, auth].join('\n')
}

/** A plausible success per provider and endpoint, for requests no rule answers. */
function defaultAnswer(host: string, path: string, method: string, json: unknown, seq: number) {
  const body = (json ?? {}) as Record<string, unknown>
  if (host === 'slack.com') {
    const methodName = path.replace(/^\/api\//, '')
    switch (methodName) {
      case 'chat.postMessage':
      case 'chat.update':
        return {
          ok: true,
          channel: body.channel ?? 'C0FAKE',
          ts: `${1_700_000_000 + seq}.000100`,
          message: { text: body.text ?? '' },
        }
      case 'auth.test':
        return {
          ok: true,
          url: 'https://fake.slack.com/',
          team: 'Fake',
          team_id: 'T0FAKE',
          user_id: 'U0BOT',
          bot_id: 'B0BOT',
        }
      case 'conversations.list':
        return {
          ok: true,
          channels: [{ id: 'C0FAKE', name: 'general', is_private: false }],
          response_metadata: { next_cursor: '' },
        }
      case 'oauth.v2.access':
        return {
          ok: true,
          access_token: `xoxb-fake-${seq}`,
          scope: 'chat:write,channels:read',
          bot_user_id: 'U0BOT',
          team: { id: 'T0FAKE', name: 'Fake' },
          is_enterprise_install: false,
        }
      default:
        return { ok: true }
    }
  }
  if (host === 'hooks.slack.com') return 'ok'
  if (host === 'api.linear.app') {
    const query = typeof body.query === 'string' ? body.query : ''
    if (query.includes('issueCreate')) {
      return {
        data: {
          issueCreate: {
            success: true,
            issue: {
              id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
              identifier: `FAKE-${seq}`,
              url: `https://linear.app/fake/issue/FAKE-${seq}`,
            },
          },
        },
      }
    }
    if (query.includes('teams')) {
      return { data: { teams: { nodes: [{ id: 'team-fake', name: 'Fake', key: 'FAKE' }] } } }
    }
    if (path.endsWith('/oauth/token')) {
      return { access_token: `lin-fake-${seq}`, token_type: 'Bearer', scope: 'read,write' }
    }
    return { data: {} }
  }
  if (
    host === 'api.github.com' &&
    method === 'POST' &&
    /\/repos\/[^/]+\/[^/]+\/issues$/.test(path)
  ) {
    const repo = path.split('/').slice(2, 4).join('/')
    return { id: seq, number: seq, html_url: `https://github.com/${repo}/issues/${seq}` }
  }
  if (host === 'discord.com' && method === 'POST') return { id: String(10_000 + seq) }
  return {}
}

export function createFakeProvider() {
  const rules: StoredRule[] = []
  const requests: RecordedProviderRequest[] = []
  let seq = 0

  function findRule(host: string, text: string): StoredRule | null {
    for (let i = rules.length - 1; i >= 0; i--) {
      const rule = rules[i]
      if (rule.host && rule.host !== host) continue
      if (!text.includes(rule.marker)) continue
      if (rule.times !== undefined && rule.uses >= rule.times) continue
      return rule
    }
    return null
  }

  async function handleProvider(request: Request, url: URL): Promise<Response> {
    const [, host = '', ...rest] = url.pathname.split('/')
    const path = `/${rest.join('/')}`
    const body = await request.text()
    const contentType = request.headers.get('content-type') ?? ''
    const json = parseBody(body, contentType)
    const auth = request.headers.get('authorization') ?? ''
    const text = matchText(request.method, path, url.search, body, auth)
    const rule = findRule(host, text)
    if (rule) rule.uses++
    const n = ++seq

    if (rule?.delayMs) await new Promise((r) => setTimeout(r, rule.delayMs))

    const status = rule?.status ?? 200
    const answer =
      rule && 'json' in rule
        ? rule.json
        : rule?.text !== undefined
          ? rule.text
          : rule?.status && rule.status >= 400
            ? { error: 'fake provider failure' }
            : defaultAnswer(host, path, request.method, json, n)

    requests.push({
      seq: n,
      at: new Date().toISOString(),
      host,
      method: request.method,
      path,
      query: url.search,
      headers: Object.fromEntries(request.headers),
      body,
      json,
      text,
      matched: rule?.marker ?? null,
      status,
    })
    if (requests.length > MAX_RECORDED) requests.splice(0, requests.length - MAX_RECORDED)

    const headers = new Headers(rule?.headers)
    if (typeof answer === 'string') {
      if (!headers.has('content-type')) headers.set('content-type', 'text/plain')
      return new Response(answer, { status, headers })
    }
    headers.set('content-type', 'application/json')
    return new Response(JSON.stringify(answer), { status, headers })
  }

  async function fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname.replace(/\/+$/, '')

    if (path === '/__fake/health') return Response.json({ ok: true })
    if (path === '/__fake/rules' && request.method === 'POST') {
      const rule = (await request.json()) as FakeProviderRule
      if (!rule || typeof rule.marker !== 'string' || rule.marker.length < 4) {
        return Response.json({ error: 'marker (4+ chars) is required' }, { status: 400 })
      }
      rules.push({ ...rule, uses: 0 })
      return Response.json({ ok: true, rules: rules.length })
    }
    if (path === '/__fake/rules' && request.method === 'DELETE') {
      const marker = url.searchParams.get('marker')
      for (let i = rules.length - 1; i >= 0; i--) if (rules[i].marker === marker) rules.splice(i, 1)
      return Response.json({ ok: true })
    }
    if (path === '/__fake/requests' && request.method === 'GET') {
      const contains = url.searchParams.get('contains')
      const host = url.searchParams.get('host')
      return Response.json(
        requests.filter(
          (r) => (!contains || r.text.includes(contains)) && (!host || r.host === host)
        )
      )
    }
    return handleProvider(request, url)
  }

  return { fetch }
}

if (import.meta.main) {
  const { providerFakePort } = supportEnv()
  const fake = createFakeProvider()
  Bun.serve({ port: providerFakePort, hostname: '127.0.0.1', fetch: fake.fetch, idleTimeout: 0 })
  process.stdout.write(`provider fake listening on http://127.0.0.1:${providerFakePort}\n`)
}
