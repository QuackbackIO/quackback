/**
 * The designer's signed-out view: the frame asks, and only someone who may
 * change the portal's branding is answered as nobody signed in. These drive
 * the real request session reader with the request each case would carry.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

let currentHeaders = new Headers()
let currentUrl = 'http://acme.localhost/'
vi.mock('@tanstack/react-start/server', () => ({
  getRequestHeaders: () => currentHeaders,
  getRequest: () => ({ url: currentUrl, headers: currentHeaders }),
}))

const sessions = new Map<string, { scope: string; userId: string }>()
vi.mock('@/lib/server/auth/index', () => ({
  auth: {
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const token = /session_token=([^;]+)/.exec(headers.get('cookie') ?? '')?.[1]
        const found = token ? sessions.get(token) : undefined
        if (!found) return null
        const now = new Date()
        return {
          session: {
            id: `sess_${found.userId}`,
            token,
            scope: found.scope,
            expiresAt: now,
            createdAt: now,
            updatedAt: now,
          },
          user: { id: found.userId, email: `${found.userId}@example.com`, name: found.userId },
        }
      },
    },
  },
}))
vi.mock('@/lib/server/auth/session-audience', () => ({
  healStrandedPortalSession: async (session: unknown) => session,
}))

const principals = new Map<string, { id: string; userId: string; role: string; type: string }>()
vi.mock('@/lib/server/db', () => ({
  db: {
    query: {
      principal: {
        findFirst: async (args: { where: { val: string } }) => principals.get(args.where.val),
      },
    },
  },
  principal: { userId: 'principal.userId' },
  eq: (col: string, val: string) => ({ col, val }),
}))

const grants = new Map<string, string[]>()
vi.mock('@/lib/server/policy/permissions', () => ({
  permissionsForPrincipal: async (principalId: string) => new Set(grants.get(principalId) ?? []),
}))

const { runWithLogContext } = await import('@/lib/server/log-context')
const { getRequestSession, getSessionOfRequest } = await import('../request-session')
const { asksSignedOut } = await import('../preview-visitor')

let seq = 0
function inRequest<T>(
  request: { token?: string; headers?: Record<string, string>; url?: string },
  fn: () => Promise<T>
): Promise<T> {
  currentHeaders = new Headers({
    ...(request.token ? { cookie: `better-auth.session_token=${request.token}` } : {}),
    ...request.headers,
  })
  currentUrl = request.url ?? 'http://acme.localhost/'
  return runWithLogContext({ request_id: `req_${++seq}` }, fn)
}

function addPerson(token: string, userId: string, permissions: string[], scope = 'dashboard') {
  sessions.set(token, { scope, userId })
  principals.set(userId, { id: `principal_${userId}`, userId, role: 'member', type: 'user' })
  grants.set(`principal_${userId}`, permissions)
}

const FRAME_DOC = {
  headers: { 'sec-fetch-dest': 'iframe' },
  url: 'http://acme.localhost/feedback?preview=true&designer=1&visitor=out',
}
const FRAME_CALL = { headers: { 'x-qb-preview-visitor': 'out' } }

beforeEach(() => {
  sessions.clear()
  principals.clear()
  grants.clear()
  addPerson('tok_admin', 'user_admin', ['settings.branding'])
  addPerson('tok_member', 'user_member', ['posts.manage'])
  addPerson('tok_portal_admin', 'user_portal_admin', ['settings.branding'], 'portal')
})

describe('the signed-out view', () => {
  it('answers the frame as nobody for someone who may change branding', async () => {
    expect(await inRequest({ token: 'tok_admin', ...FRAME_DOC }, getRequestSession)).toBeNull()
    expect(await inRequest({ token: 'tok_admin', ...FRAME_CALL }, getRequestSession)).toBeNull()
  })

  it('ignores the ask from someone without branding permission', async () => {
    const doc = await inRequest({ token: 'tok_member', ...FRAME_DOC }, getRequestSession)
    const call = await inRequest({ token: 'tok_member', ...FRAME_CALL }, getRequestSession)
    expect(doc?.user.id).toBe('user_member')
    expect(call?.user.id).toBe('user_member')
  })

  it('ignores the ask from a session outside the dashboard', async () => {
    const session = await inRequest({ token: 'tok_portal_admin', ...FRAME_CALL }, getRequestSession)
    expect(session?.user.id).toBe('user_portal_admin')
  })

  it('ignores the address outside a frame', async () => {
    const topLevel = await inRequest(
      { token: 'tok_admin', headers: { 'sec-fetch-dest': 'document' }, url: FRAME_DOC.url },
      getRequestSession
    )
    expect(topLevel?.user.id).toBe('user_admin')
  })

  it('keeps the session for the signed-in view and any other frame', async () => {
    const signedIn = await inRequest(
      {
        token: 'tok_admin',
        headers: { 'sec-fetch-dest': 'iframe' },
        url: 'http://acme.localhost/feedback?preview=true&designer=1',
      },
      getRequestSession
    )
    const other = await inRequest(
      {
        token: 'tok_admin',
        headers: { 'sec-fetch-dest': 'iframe' },
        url: 'http://acme.localhost/feedback?visitor=out',
      },
      getRequestSession
    )
    expect(signedIn?.user.id).toBe('user_admin')
    expect(other?.user.id).toBe('user_admin')
  })
})

describe('a server route reading its own request', () => {
  const request = (token: string, headers: Record<string, string> = {}) =>
    new Request('http://acme.localhost/api/v1/users/principal_x/card', {
      headers: { cookie: `better-auth.session_token=${token}`, ...headers },
    })

  it('answers the signed-out frame as nobody, by the same rule', async () => {
    expect(await getSessionOfRequest(request('tok_admin', FRAME_CALL.headers))).toBeNull()
    expect((await getSessionOfRequest(request('tok_admin')))?.user.id).toBe('user_admin')
  })

  it('only ever takes access away', async () => {
    const member = await getSessionOfRequest(request('tok_member', FRAME_CALL.headers))
    const portal = await getSessionOfRequest(request('tok_portal_admin', FRAME_CALL.headers))
    expect(member?.user.id).toBe('user_member')
    expect(portal?.user.id).toBe('user_portal_admin')
    expect(await getSessionOfRequest(request('tok_nobody', FRAME_CALL.headers))).toBeNull()
  })
})

describe('asksSignedOut', () => {
  const ask = (headers: Record<string, string>, url = FRAME_DOC.url) =>
    asksSignedOut({ headers: new Headers(headers), url: () => url })

  it('reads the preview header or a framed signed-out address only', () => {
    expect(ask({ 'x-qb-preview-visitor': 'out' })).toBe(true)
    expect(ask({ 'x-qb-preview-visitor': 'in' })).toBe(false)
    expect(ask({ 'sec-fetch-dest': 'iframe' })).toBe(true)
    expect(ask({})).toBe(false)
    expect(ask({ 'sec-fetch-dest': 'iframe' }, 'not a url')).toBe(false)
  })
})
