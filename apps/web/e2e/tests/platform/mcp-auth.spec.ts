/**
 * How callers reach the MCP server (/api/mcp): transport refusals, the OAuth
 * challenge and discovery documents, OAuth role re-reads, scope step-up,
 * in-band scope refusals for keys, the tool listing, the browser consent
 * flow, client registration, and the audit trail of tool calls.
 *
 * Journeys: API-M-02, API-M-03, API-M-04, API-M-05, API-M-06, API-M-07,
 * API-M-09, API-M-14, API-M-15, API-M-16, API-M-17, API-M-19, API-M-20,
 * API-M-21, API-M-22, API-M-23, API-M-24, API-M-25, API-M-26, API-M-30,
 * API-M-91.
 *
 * API-M-09 and API-M-30 switch a workspace-wide developer setting and run in
 * the isolated job only.
 */
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { ISOLATED } from '../../support/automation'
import { withSettings } from '../../support/isolated-settings'
import { callServerFn, personApi } from '../../support/server-fns'
import {
  apiFor,
  fixture,
  mcpCall,
  mcpRpc,
  newTeammate,
  seedCustomer,
} from '../../support/api-client'
import {
  ALL_SCOPES,
  adminApi,
  authorizeUrl,
  catchRedirect,
  exchangeCode,
  expectToolError,
  keyApi,
  newBoard,
  newPost,
  oauthApi,
  pkce,
  rawRpc,
  registerClient,
  toolAudit,
  toolCallMsg,
  uuid,
  waitForAudit,
} from '../../product/mcp'

test.describe.configure({ timeout: 60_000 })

const TEAM_ROLE_ERROR = 'Error: This operation requires a team member (admin or member) role.'
const CHALLENGE_SCOPES =
  'read:feedback write:feedback write:changelog read:article write:article read:chat write:chat read:settings write:settings'

/**
 * Every consent submit (Authorize or Deny) fails today: the router rewrites
 * the repeated `ba_param` query parameter into one JSON array before the page
 * posts `window.location.search` as `oauth_query`, so Better Auth answers
 * 400 `invalid_signature`. See QUARANTINE.md.
 */
const CONSENT_QUARANTINE = {
  type: 'quarantine',
  description:
    'Product bug: /oauth/consent posts a router-rewritten query (ba_param as a JSON array) and Better Auth refuses it with invalid_signature (routes/oauth/consent.tsx handleConsent). See QUARANTINE.md.',
}

function stepUpDescription(what: string, scopes: string): string {
  return `This connection is not allowed to ${what} (missing scope: ${scopes}). Reconnect and choose Full access to allow it.`
}

/** The `scope="..."` parameter of a WWW-Authenticate header. */
function scopeParam(header: string | undefined): string {
  return /scope="([^"]*)"/.exec(header?.replace(/error_description="[^"]*"/, '') ?? '')?.[1] ?? ''
}

test.describe('MCP transport and discovery', () => {
  test(
    'API-M-02 only POST is served, before any auth',
    { tag: '@nightly' },
    async ({ playwright, baseURL }) => {
      const api = await apiFor(playwright, baseURL, 'not-a-real-token')
      for (const res of [
        await api.get('/api/mcp', { headers: { accept: 'text/event-stream' } }),
        await api.delete('/api/mcp'),
      ]) {
        expect(res.status()).toBe(405)
        expect(res.headers()['allow']).toBe('POST')
        expect(res.headers()['content-type']).toContain('application/json')
        expect(await res.json()).toEqual({
          jsonrpc: '2.0',
          error: { code: -32000, message: 'Method not allowed. Send MCP requests with POST.' },
          id: null,
        })
      }
    }
  )

  test(
    'API-M-03 an oversized request is answered 413 naming the upload limit, before auth',
    { tag: '@nightly' },
    async ({ playwright, baseURL }) => {
      const api = await apiFor(playwright, baseURL, null)
      const res = await api.post('/api/mcp', {
        headers: { 'content-type': 'application/json' },
        data: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'x', pad: 'a'.repeat(5_000_000) }),
      })
      expect(res.status()).toBe(413)
      const body = await res.json()
      expect(body.error.code).toBe(-32001)
      expect(body.error.message).toMatch(
        /^Request is too large \(max [\d.]+ MB\)\. upload_file accepts files up to 3 MB; upload larger files with the REST API \(POST \/api\/v1\/files\)\.$/
      )
    }
  )

  test(
    'API-M-04 the unauthenticated challenge asks for every capability',
    { tag: '@core' },
    async ({ playwright, baseURL }) => {
      const challenge = `Bearer scope="${CHALLENGE_SCOPES}", resource_metadata="${baseURL}/.well-known/oauth-protected-resource"`
      for (const [token, error] of [
        [null, 'Authentication required'],
        ['garbage-token', 'Authentication required'],
        [
          `qb_${'0'.repeat(48)}`,
          'Invalid or missing API key. Provide a valid key in the Authorization header: Bearer qb_xxx',
        ],
      ] as const) {
        const res = await mcpRpc(await apiFor(playwright, baseURL, token), 'tools/list')
        expect(res.status(), String(token)).toBe(401)
        expect(await res.json()).toEqual({ error })
        expect(res.headers()['www-authenticate']).toBe(challenge)
        expect(res.headers()['www-authenticate']).not.toContain('offline_access')
      }
    }
  )

  test(
    'API-M-05 the protected resource metadata names only the first-connect reads',
    { tag: '@nightly' },
    async ({ playwright, baseURL }) => {
      const api = await apiFor(playwright, baseURL, null)
      const expected = {
        resource: `${baseURL}/api/mcp`,
        authorization_servers: [`${baseURL}/api/auth`],
        bearer_methods_supported: ['header'],
        scopes_supported: ['read:feedback', 'read:article', 'read:chat', 'read:settings'],
      }
      for (const path of [
        '/.well-known/oauth-protected-resource',
        '/.well-known/oauth-protected-resource/api/mcp',
      ]) {
        const res = await api.get(path)
        expect(res.status(), path).toBe(200)
        expect(await res.json()).toEqual(expected)
        expect(res.headers()['cache-control']).toBe('public, max-age=3600')
        expect(res.headers()['vary']).toContain('Host')
      }
    }
  )

  test(
    'API-M-06 the authorization server metadata is served at both well-known URLs',
    { tag: '@nightly' },
    async ({ playwright, baseURL }) => {
      const api = await apiFor(playwright, baseURL, null)
      const a = await (await api.get('/.well-known/oauth-authorization-server')).json()
      const b = await (await api.get('/.well-known/oauth-authorization-server/api/auth')).json()
      expect(b).toEqual(a)
      expect(a.issuer).toBe(`${baseURL}/api/auth`)
      for (const key of [
        'registration_endpoint',
        'authorization_endpoint',
        'token_endpoint',
        'device_authorization_endpoint',
      ]) {
        expect(a[key], key).toMatch(new RegExp(`^${baseURL}/api/auth/`))
      }
      expect(a.scopes_supported).toEqual(
        expect.arrayContaining(['openid', 'profile', 'email', 'offline_access', ...ALL_SCOPES])
      )
      expect(a.client_id_metadata_document_supported).toBe(true)
    }
  )
})

test.describe('MCP callers', () => {
  test(
    "API-M-07 an OAuth token follows the teammate's current role, permissions and existence",
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      fixture({ op: 'enablePortalMcp' })
      const admin = await adminApi(playwright, baseURL, people)
      const board = await newBoard(admin, marker)
      const post = await newPost(admin, board.id, `${marker} post`)
      const mate = newTeammate(`${marker} mate`, ['post.view_private', 'member.view'])
      const oauth = await oauthApi(playwright, baseURL, mate.email, ALL_SCOPES)

      const first = await mcpCall(oauth, 'search', { query: marker })
      expect(first.isError, first.text).toBe(false)
      expect(first.json.posts.map((p: { id: string }) => p.id)).toEqual([post.id])

      // A narrowed role takes effect on the next call.
      fixture({ op: 'setPermissions', roleId: mate.roleId, permissions: ['member.view'] })
      expectToolError(
        await mcpCall(oauth, 'search', { query: marker }),
        "Error: This operation requires the 'post.view_private' permission. Ask a workspace owner or an admin to grant it."
      )

      // Removed from the team: a portal user now (portal MCP access is on).
      fixture({ op: 'leave', principalId: mate.principalId })
      expectToolError(await mcpCall(oauth, 'search', { query: marker }), TEAM_ROLE_ERROR)

      // Deleted: the token no longer resolves.
      await supportDb()`DELETE FROM principal WHERE id = ${uuid(mate.principalId)}`
      const gone = await mcpRpc(oauth, 'tools/list')
      expect(gone.status()).toBe(401)
      expect(await gone.json()).toEqual({ error: 'Authentication required' })
      expect(gone.headers()['www-authenticate']).toContain('resource_metadata=')
    }
  )

  test(
    'API-M-09 a portal user is refused while portal MCP access is off',
    { tag: ['@core', '@isolated'] },
    async ({ playwright, baseURL, people, marker }) => {
      test.skip(!ISOLATED, 'runs in product-isolated')
      const admin = await adminApi(playwright, baseURL, people)
      const board = await newBoard(admin, marker)
      const post = await newPost(admin, board.id, `${marker} post`)
      await seedCustomer(`${marker}@customers.example`)
      const portal = await oauthApi(playwright, baseURL, `${marker}@customers.example`, ALL_SCOPES)

      await withSettings({ developer_config: { mcpPortalAccessEnabled: false } }, async () => {
        for (const msg of [
          { jsonrpc: '2.0', id: 'list-1', method: 'tools/list', params: {} },
          { ...toolCallMsg('vote_post', { postId: post.id }), id: 'vote-1' },
        ]) {
          const res = await rawRpc(portal, msg)
          expect(res.status).toBe(403)
          expect(res.body).toEqual({
            jsonrpc: '2.0',
            error: {
              code: -32001,
              message: 'Portal user MCP access is disabled by the administrator.',
            },
            id: msg.id,
          })
        }
      })
      const [row] = await supportDb()`SELECT vote_count FROM posts WHERE id = ${uuid(post.id)}`
      expect(row.vote_count).toBe(post.voteCount)
    }
  )

  test(
    'API-M-19 scoped keys are refused in-band per domain and the refusal is audited',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await adminApi(playwright, baseURL, people)
      const board = await newBoard(admin, marker)
      const post = await newPost(admin, board.id, `${marker} post`)
      const cases = [
        ['read:feedback', 'triage_post', { postId: post.id }, 'write:feedback'],
        ['write:feedback', 'create_changelog', { title: marker, content: 'x' }, 'write:changelog'],
        ['read:article', 'update_article', { articleId: 'article_01abc' }, 'write:article'],
        [
          'read:settings',
          'update_settings',
          { area: 'portal', patch: { displayName: marker } },
          'write:settings',
        ],
      ] as const
      for (const [scope, tool, args, needed] of cases) {
        const key = await keyApi(playwright, baseURL, {
          creatorEmail: people.people.admin.email,
          scopes: [scope],
        })
        const res = await mcpCall(key.api, tool, args)
        expect(res.status).toBe(200)
        expectToolError(res, `Error: Insufficient scope. Required: ${needed}`)
        const [audit] = await waitForAudit({ tool, credentialId: key.id })
        expect(audit).toMatchObject({
          event_outcome: 'failure',
          channel: 'mcp',
          credential_kind: 'api_key',
          metadata: { tool, errorCode: 'INSUFFICIENT_SCOPE' },
        })
      }
    }
  )

  test(
    'API-M-91 write tool calls are audited with the caller and target; reads never; refusals as failures',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await adminApi(playwright, baseURL, people)
      const board = await newBoard(admin, marker)
      const post = await newPost(admin, board.id, `${marker} post`)
      const mate = newTeammate(`${marker} mate`, [
        'post.view_private',
        'post.create',
        'post.set_status',
        'member.view',
      ])

      const oauth = await oauthApi(playwright, baseURL, mate.email, ALL_SCOPES)
      const created = await mcpCall(oauth, 'create_post', {
        boardId: board.id,
        title: `${marker} oauth post`,
      })
      expect(created.isError, created.text).toBe(false)
      const oauthRows = await waitForAudit({ tool: 'create_post', targetId: board.id })
      expect(oauthRows).toHaveLength(1)
      expect(oauthRows[0]).toMatchObject({
        event_outcome: 'success',
        channel: 'mcp',
        actor_type: 'user',
        auth_method: 'oauth',
        actor_user_id: uuid(mate.userId),
        credential_kind: 'oauth_client',
        credential_id: 'e2e-mcp-client',
        on_behalf_of_principal_id: uuid(mate.principalId),
        target_type: 'board',
      })
      // Neither arguments nor results are stored.
      expect(Object.keys(oauthRows[0].metadata).sort()).toEqual(['tool'])

      const key = await keyApi(playwright, baseURL, { creatorEmail: mate.email })
      const triaged = await mcpCall(key.api, 'triage_post', {
        postId: post.id,
        statusId: post.statusId,
      })
      expect(triaged.isError, triaged.text).toBe(false)
      const [keyRow] = await waitForAudit({ tool: 'triage_post', credentialId: key.id })
      expect(keyRow).toMatchObject({
        event_outcome: 'success',
        channel: 'mcp',
        credential_kind: 'api_key',
        on_behalf_of_principal_id: uuid(mate.principalId),
        target_type: 'post',
        target_id: post.id,
      })

      expect((await mcpCall(key.api, 'search', { query: marker })).isError).toBe(false)
      const refused = await mcpCall(key.api, 'delete_post', { postId: post.id })
      expect(refused.isError).toBe(true)
      const [refusedRow] = await waitForAudit({ tool: 'delete_post', credentialId: key.id })
      expect(refusedRow).toMatchObject({
        event_outcome: 'failure',
        target_id: post.id,
        metadata: { tool: 'delete_post', errorCode: 'MISSING_PERMISSION' },
      })
      expect(await toolAudit({ tool: 'search', credentialId: key.id })).toEqual([])
    }
  )
})

test.describe('MCP OAuth scope step-up', () => {
  test(
    'API-M-14 step-up wording and scope set for changelog, article and settings writes',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people }) => {
      const oauth = await oauthApi(playwright, baseURL, people.people.admin.email, [
        'read:feedback',
        'read:article',
      ])
      const cases = [
        [
          'create_changelog',
          { title: 'x', content: 'y' },
          stepUpDescription('make changes to Changelog', 'write:changelog'),
          'read:feedback write:changelog read:article',
        ],
        [
          'create_article',
          { categoryId: 'kb_category_01abc', title: 'x', content: 'y' },
          stepUpDescription('make changes to Help Center', 'write:article'),
          'read:feedback read:article write:article',
        ],
        [
          'update_settings',
          { area: 'portal', patch: {} },
          stepUpDescription('make changes to Settings', 'write:settings'),
          'read:feedback read:article read:settings write:settings',
        ],
      ] as const
      for (const [tool, args, description, scope] of cases) {
        const res = await rawRpc(oauth, toolCallMsg(tool, args))
        expect(res.status, tool).toBe(403)
        expect(res.body.result.content[0].text).toBe(description)
        expect(scopeParam(res.headers['www-authenticate'])).toBe(scope)
      }
    }
  )

  test(
    'API-M-15 a resource read is stepped up as a JSON-RPC error; resources/list needs no scope',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people }) => {
      const oauth = await oauthApi(playwright, baseURL, people.people.admin.email, [
        'read:feedback',
      ])
      const res = await rawRpc(oauth, {
        jsonrpc: '2.0',
        id: 'read-1',
        method: 'resources/read',
        params: { uri: 'quackback://help-center/categories' },
      })
      expect(res.status).toBe(403)
      expect(res.body.id).toBe('read-1')
      expect(res.body.error.code).toBe(-32003)
      expect(res.body.error.message).toBe(stepUpDescription('read Help Center', 'read:article'))
      expect(res.body.error.data['mcp/www_authenticate']).toEqual([res.headers['www-authenticate']])
      const list = await mcpRpc(oauth, 'resources/list')
      expect(list.status()).toBe(200)
    }
  )

  test(
    'API-M-16 a batch with any refused call runs nothing',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await adminApi(playwright, baseURL, people)
      const board = await newBoard(admin, marker)
      const oauth = await oauthApi(playwright, baseURL, people.people.admin.email, [
        'read:feedback',
      ])
      const res = await rawRpc(oauth, [
        toolCallMsg('search', {}),
        toolCallMsg('create_post', { boardId: board.id, title: `${marker} batch` }),
        toolCallMsg('create_article', {
          categoryId: 'kb_category_01abc',
          title: marker,
          content: 'x',
        }),
      ])
      expect(res.status).toBe(403)
      expect(Array.isArray(res.body)).toBe(true)
      expect(res.body).toHaveLength(3)
      for (const answer of res.body) expect(answer.result.isError).toBe(true)
      expect(res.headers['www-authenticate']).toContain(
        'missing scope: write:feedback write:article'
      )
      const rows = await supportDb()`SELECT id FROM posts WHERE board_id = ${uuid(board.id)}`
      expect(rows).toHaveLength(0)
    }
  )

  test(
    'API-M-17 step-up keeps offline_access for a refreshable token only',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people }) => {
      const refreshable = await oauthApi(playwright, baseURL, people.people.admin.email, [
        'offline_access',
        'read:feedback',
      ])
      const plain = await oauthApi(playwright, baseURL, people.people.admin.email, [
        'read:feedback',
      ])
      const call = toolCallMsg('triage_post', { postId: 'post_01abc' })
      const a = await rawRpc(refreshable, call)
      const b = await rawRpc(plain, call)
      expect(scopeParam(a.headers['www-authenticate'])).toBe(
        'offline_access read:feedback write:feedback'
      )
      expect(scopeParam(b.headers['www-authenticate'])).toBe('read:feedback write:feedback')
    }
  )

  test(
    'API-M-20 search, get_details and navigate_workspace pick their scope from the arguments',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people }) => {
      const email = people.people.admin.email
      const feedbackOnly = await oauthApi(playwright, baseURL, email, ['read:feedback'])
      const articleOnly = await oauthApi(playwright, baseURL, email, ['read:article'])
      const missing = async (api: Parameters<typeof rawRpc>[0], tool: string, args: object) => {
        const res = await rawRpc(api, toolCallMsg(tool, args as Record<string, unknown>))
        return res.status === 403
          ? /missing scope: ([^)]*)\)/.exec(res.body.result.content[0].text)?.[1]
          : null
      }
      expect(await missing(feedbackOnly, 'search', { entity: 'articles' })).toBe('read:article')
      expect(
        await missing(feedbackOnly, 'get_details', { id: 'article_01kc3m4vh5e0bsn5tdp6yrjbjn' })
      ).toBe('read:article')
      expect(
        await missing(feedbackOnly, 'get_details', { id: 'kb_category_01kc3m4vh5e0bsn5tdp6yrjbjn' })
      ).toBe('read:article')
      expect(await missing(articleOnly, 'search', {})).toBe('read:feedback')
      expect(
        await missing(articleOnly, 'get_details', { id: 'post_01kc3m4vh5e0bsn5tdp6yrjbjn' })
      ).toBe('read:feedback')
      expect(await missing(articleOnly, 'get_details', { id: 'not-a-typeid' })).toBe(
        'read:feedback'
      )
      for (const [destination, scope] of [
        ['articles', 'read:article'],
        ['status', 'read:settings'],
        ['members', 'read:settings'],
      ] as const) {
        expect(
          await missing(feedbackOnly, 'navigate_workspace', { destination }),
          destination
        ).toBe(scope)
      }
      for (const destination of ['feedback', 'boards', 'changelog']) {
        expect(
          await missing(feedbackOnly, 'navigate_workspace', { destination }),
          destination
        ).toBeNull()
      }
    }
  )

  test(
    "API-M-21 the tool listing advertises each tool's scopes, the same for every caller",
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      fixture({ op: 'enablePortalMcp' })
      const admin = await adminApi(playwright, baseURL, people)
      const reader = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        scopes: ['read:feedback'],
      })
      await seedCustomer(`${marker}@customers.example`)
      const portal = await oauthApi(playwright, baseURL, `${marker}@customers.example`, [
        'read:feedback',
      ])
      const listings = []
      for (const api of [admin, reader.api, portal]) {
        const res = await mcpRpc(api, 'tools/list')
        expect(res.status()).toBe(200)
        listings.push((await res.json()).result.tools)
      }
      expect(listings[1]).toEqual(listings[0])
      expect(listings[2]).toEqual(listings[0])
      const tools = new Map(listings[0].map((t: { name: string }) => [t.name, t] as const)) as Map<
        string,
        {
          _meta?: { securitySchemes?: { scopes: string[] }[] }
          annotations?: Record<string, boolean>
        }
      >
      expect(tools.size).toBe(43)
      expect(tools.has('list_suggestions')).toBe(false)
      const scopesOf = (name: string) => tools.get(name)?._meta?.securitySchemes?.[0]?.scopes
      expect(scopesOf('create_post')).toEqual(['write:feedback'])
      expect(scopesOf('create_changelog')).toEqual(['write:changelog'])
      expect(scopesOf('update_settings')).toEqual(['write:settings'])
      expect(scopesOf('search')).toEqual(['read:feedback', 'read:article'])
      expect(scopesOf('get_details')).toEqual(['read:feedback', 'read:article'])
      expect(scopesOf('navigate_workspace')).toEqual([
        'read:feedback',
        'read:chat',
        'read:article',
        'read:settings',
      ])
      expect(tools.get('search')?.annotations?.readOnlyHint).toBe(true)
      expect(tools.get('delete_post')?.annotations?.destructiveHint).toBe(true)
    }
  )
})

test.describe('MCP OAuth consent', () => {
  async function connect(
    opts: {
      page: import('@playwright/test').Page
      request: import('@playwright/test').APIRequestContext
      baseURL: string
      clientName: string
      scope: string
    },
    choose?: (page: import('@playwright/test').Page) => Promise<void>
  ) {
    const reg = await registerClient(opts.request, opts.clientName)
    expect(reg.status(), await reg.text()).toBeLessThan(300)
    const clientId = (await reg.json()).client_id as string
    const { verifier, challenge } = pkce()
    const caught = await catchRedirect(opts.page)
    await opts.page.goto(
      authorizeUrl({ baseURL: opts.baseURL, clientId, scope: opts.scope, state: 'st-1', challenge })
    )
    await expect(opts.page).toHaveURL(/\/oauth\/consent/)
    await expect(opts.page.getByRole('button', { name: 'Authorize', exact: true })).toBeVisible()
    if (choose) await choose(opts.page)
    return { clientId, verifier, caught }
  }

  const fullAccessSummary = (clientName: string) =>
    `${clientName} can read and make changes across your workspace, including settings, up to what your role allows.`

  test(
    'API-M-22 a plain MCP connect lands on consent with Full access prefilled',
    { tag: '@core' },
    async ({ asPerson, playwright, baseURL, marker }) => {
      const page = await asPerson('admin')
      const request = await apiFor(playwright, baseURL, null)
      const clientName = `${marker} client`
      // The 401 challenge's scopes, the four first-connect reads, or no capability.
      for (const scope of [
        CHALLENGE_SCOPES,
        'read:feedback read:article read:chat read:settings',
        'openid',
      ]) {
        await connect({ page, request, baseURL: baseURL!, clientName, scope })
        await expect(page.getByRole('radio', { name: /Full access/ }), scope).toBeChecked()
        await expect(page.getByText(fullAccessSummary(clientName))).toBeVisible()
        await expect(page).toHaveURL(/[?&]qb_requested_scope=/)
      }
    }
  )

  test(
    'API-M-22 authorizing Full access yields a token that writes',
    { tag: ['@core', '@quarantine'], annotation: CONSENT_QUARANTINE },
    async ({ asPerson, playwright, baseURL, people, marker }) => {
      const page = await asPerson('admin')
      const request = await apiFor(playwright, baseURL, null)
      const clientName = `${marker} client`
      const flow = await connect({
        page,
        request,
        baseURL: baseURL!,
        clientName,
        scope: CHALLENGE_SCOPES,
      })
      await expect(page.getByRole('radio', { name: /Full access/ })).toBeChecked()
      await page.getByRole('button', { name: 'Authorize', exact: true }).click()
      const redirect = await flow.caught()
      expect(redirect.searchParams.get('state')).toBe('st-1')
      const code = redirect.searchParams.get('code')
      expect(code).toBeTruthy()

      const tokens = await exchangeCode(request, {
        clientId: flow.clientId,
        code: code!,
        verifier: flow.verifier,
      })
      const granted = String(tokens.scope).split(' ')
      expect(granted).toEqual(expect.arrayContaining([...ALL_SCOPES]))

      const admin = await adminApi(playwright, baseURL, people)
      const board = await newBoard(admin, marker)
      const mcp = await apiFor(playwright, baseURL, tokens.access_token)
      const created = await mcpCall(mcp, 'create_post', { boardId: board.id, title: `${marker} p` })
      expect(created.isError, created.text).toBe(false)
    }
  )

  test(
    'API-M-23 a step-up authorize prefills Custom with reads plus exactly the requested writes',
    { tag: '@nightly' },
    async ({ asPerson, playwright, baseURL, marker }) => {
      const page = await asPerson('admin')
      const request = await apiFor(playwright, baseURL, null)
      await connect({
        page,
        request,
        baseURL: baseURL!,
        clientName: `${marker} client`,
        scope: 'read:feedback read:article write:changelog',
      })
      await expect(page.getByRole('radio', { name: /Custom/ })).toBeChecked()
      const detail = page.locator('#consent-access-detail')
      await expect(detail).toBeVisible()
      await expect(detail.getByRole('button', { name: 'Changelog: Write' })).toHaveAttribute(
        'aria-pressed',
        'true'
      )
      await expect(
        detail.getByRole('button', { name: 'Feedback: Read', exact: true })
      ).toHaveAttribute('aria-pressed', 'true')
      await expect(
        detail.getByRole('button', { name: 'Feedback: Read and write' })
      ).toHaveAttribute('aria-pressed', 'false')
    }
  )

  test(
    'API-M-23 authorizing a step-up grants exactly the selection',
    { tag: ['@nightly', '@quarantine'], annotation: CONSENT_QUARANTINE },
    async ({ asPerson, playwright, baseURL, marker }) => {
      const page = await asPerson('admin')
      const request = await apiFor(playwright, baseURL, null)
      const flow = await connect({
        page,
        request,
        baseURL: baseURL!,
        clientName: `${marker} client`,
        scope: 'read:feedback read:article write:changelog',
      })
      await page.getByRole('button', { name: 'Authorize', exact: true }).click()
      const code = (await flow.caught()).searchParams.get('code')!
      const tokens = await exchangeCode(request, {
        clientId: flow.clientId,
        code,
        verifier: flow.verifier,
      })
      const granted = String(tokens.scope).split(' ')
      expect(granted).toEqual(
        expect.arrayContaining(['read:feedback', 'read:article', 'write:changelog'])
      )
      for (const write of ['write:feedback', 'write:article', 'write:chat', 'write:settings']) {
        expect(granted).not.toContain(write)
      }
    }
  )

  test(
    'API-M-24 choosing Read only says the client cannot make changes',
    { tag: '@core' },
    async ({ asPerson, playwright, baseURL, marker }) => {
      const page = await asPerson('admin')
      const request = await apiFor(playwright, baseURL, null)
      const clientName = `${marker} client`
      await connect({ page, request, baseURL: baseURL!, clientName, scope: CHALLENGE_SCOPES })
      await page.getByRole('radio', { name: /Read only/ }).check()
      await expect(page.getByRole('radio', { name: /Read only/ })).toBeChecked()
      await expect(
        page.getByText(
          `${clientName} can search and read. It cannot post, reply, publish or change settings.`
        )
      ).toBeVisible()
      await expect(page.getByRole('button', { name: 'Authorize', exact: true })).toBeEnabled()
    }
  )

  test(
    'API-M-24 the Read only choice yields a token that reads but is stepped up on a write',
    { tag: ['@core', '@quarantine'], annotation: CONSENT_QUARANTINE },
    async ({ asPerson, playwright, baseURL, people, marker }) => {
      const page = await asPerson('admin')
      const request = await apiFor(playwright, baseURL, null)
      const clientName = `${marker} client`
      const flow = await connect(
        { page, request, baseURL: baseURL!, clientName, scope: CHALLENGE_SCOPES },
        async (p) => {
          await p.getByRole('radio', { name: /Read only/ }).check()
        }
      )
      await expect(
        page.getByText(
          `${clientName} can search and read. It cannot post, reply, publish or change settings.`
        )
      ).toBeVisible()
      await page.getByRole('button', { name: 'Authorize', exact: true }).click()
      const code = (await flow.caught()).searchParams.get('code')!
      const tokens = await exchangeCode(request, {
        clientId: flow.clientId,
        code,
        verifier: flow.verifier,
      })
      const capabilities = String(tokens.scope)
        .split(' ')
        .filter((s) => s.includes(':'))
        .sort()
      expect(capabilities).toEqual(['read:article', 'read:chat', 'read:feedback', 'read:settings'])

      const admin = await adminApi(playwright, baseURL, people)
      const board = await newBoard(admin, marker)
      const mcp = await apiFor(playwright, baseURL, tokens.access_token)
      expect((await mcpCall(mcp, 'search', { query: marker })).isError).toBe(false)
      const write = await rawRpc(
        mcp,
        toolCallMsg('create_post', { boardId: board.id, title: marker })
      )
      expect(write.status).toBe(403)
      expect(write.body.result.content[0].text).toBe(
        stepUpDescription('make changes to Feedback', 'write:feedback')
      )
    }
  )

  test(
    'API-M-25 turning every area off disables Authorize but not Deny',
    { tag: '@nightly' },
    async ({ asPerson, playwright, baseURL, marker }) => {
      const page = await asPerson('admin')
      const request = await apiFor(playwright, baseURL, null)
      await connect({
        page,
        request,
        baseURL: baseURL!,
        clientName: `${marker} client`,
        scope: 'read:feedback',
      })
      await page.getByRole('button', { name: /^Choose what .* can access$/ }).click()
      // Each area's chips are toggles: un-press every pressed one.
      const pressed = page.locator('#consent-access-detail button[aria-pressed="true"]')
      await expect(pressed.first()).toBeVisible()
      for (let i = 0; i < 20 && (await pressed.count()) > 0; i++) await pressed.first().click()
      await expect(pressed).toHaveCount(0)
      await expect(page.getByText('Select at least one area to continue.')).toBeVisible()
      await expect(page.getByRole('button', { name: 'Authorize', exact: true })).toBeDisabled()
      await expect(page.getByRole('button', { name: 'Deny', exact: true })).toBeEnabled()
    }
  )

  test(
    'API-M-26 Deny returns to the client with access_denied and its state, without a code',
    { tag: ['@nightly', '@quarantine'], annotation: CONSENT_QUARANTINE },
    async ({ asPerson, playwright, baseURL, marker }) => {
      const page = await asPerson('admin')
      const request = await apiFor(playwright, baseURL, null)
      const flow = await connect({
        page,
        request,
        baseURL: baseURL!,
        clientName: `${marker} client`,
        scope: CHALLENGE_SCOPES,
      })
      await page.getByRole('button', { name: 'Deny', exact: true }).click()
      const redirect = await flow.caught()
      expect(redirect.searchParams.get('error')).toBe('access_denied')
      expect(redirect.searchParams.get('state')).toBe('st-1')
      expect(redirect.searchParams.get('code')).toBeNull()
    }
  )

  test(
    'API-M-30 dynamic client registration switched off refuses new clients only',
    { tag: ['@core', '@isolated'] },
    async ({ asPerson, playwright, baseURL, marker }) => {
      test.skip(!ISOLATED, 'runs in product-isolated')
      const request = await apiFor(playwright, baseURL, null)
      const earlier = await registerClient(request, `${marker} earlier`)
      expect(earlier.status(), await earlier.text()).toBeLessThan(300)
      const clientId = (await earlier.json()).client_id as string
      const adminFns = await personApi(playwright, 'admin')

      const off = await callServerFn(adminFns, 'updateDeveloperConfigFn', {
        oauthDynamicClientRegistrationEnabled: false,
      })
      expect(off.ok, off.error).toBe(true)
      try {
        const refused = await registerClient(request, `${marker} new`)
        expect(refused.status()).toBeGreaterThanOrEqual(400)

        // The client registered before the switch still reaches consent.
        // (Completing the consent is API-M-22's job; it is quarantined.)
        const page = await asPerson('admin')
        await page.goto(
          authorizeUrl({
            baseURL: baseURL!,
            clientId,
            scope: CHALLENGE_SCOPES,
            state: 'st-1',
            challenge: pkce().challenge,
          })
        )
        await expect(page).toHaveURL(new RegExp(`/oauth/consent\\?.*client_id=${clientId}`))
        await expect(page.getByRole('button', { name: 'Authorize', exact: true })).toBeEnabled()
      } finally {
        const on = await callServerFn(adminFns, 'updateDeveloperConfigFn', {
          oauthDynamicClientRegistrationEnabled: true,
        })
        expect(on.ok, on.error).toBe(true)
      }
      const again = await registerClient(request, `${marker} after`)
      expect(again.status(), await again.text()).toBeLessThan(300)
    }
  )
})
