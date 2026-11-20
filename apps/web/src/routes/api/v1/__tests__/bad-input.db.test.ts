/**
 * Bad client input never answers 500. Each case runs the real route handler
 * against real Postgres (only the API key check is stubbed), so a malformed id
 * that reaches a typeid column, or a body that is not JSON, shows up here as
 * the 500 a caller would get.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId, generateId, type PrincipalId, type UserId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { helpCenterCategories, principal, user } from '@/lib/server/db'
import { SYSTEM_ROLE_PERMISSIONS } from '@/lib/shared/permissions'
import type { ApiAuthContext } from '@/lib/server/domains/api/auth'
import type { ApiKeyId } from '@/lib/server/domains/api-keys'

vi.mock('@/lib/server/db', async (original) => ({
  ...(await original<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: vi.fn(() => (opts: unknown) => ({ options: opts })),
}))
const auth = vi.hoisted(() => ({ context: null as unknown }))
vi.mock('@/lib/server/domains/api/auth', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/api/auth')>()),
  withApiKeyAuth: async () => auth.context,
}))
vi.mock('@/lib/server/domains/settings/settings.service', async (original) => ({
  ...(await original<typeof import('@/lib/server/domains/settings/settings.service')>()),
  isFeatureEnabled: async () => true,
}))
vi.mock('@/lib/server/domains/help-center/help-center-embedding.service', () => ({
  generateArticleEmbedding: async () => undefined,
}))

import { Route as changelogList } from '../changelog/index'
import { Route as changelogEntry } from '../changelog/$entryId'
import { Route as postsList } from '../posts/index'
import { Route as incidentsList } from '../status/incidents/index'
import { Route as servicesList } from '../status/services/index'
import { Route as serviceOne } from '../status/services/$serviceId'
import { Route as categoriesList } from '../help-center/categories/index'
import { Route as categoryOne } from '../help-center/categories/$categoryId'
import { Route as articlesList } from '../help-center/articles/index'
import { Route as articleOne } from '../help-center/articles/$articleId'
import { Route as articleFeedback } from '../help-center/articles/$articleId.feedback'
import { Route as conversationsList } from '../conversations/index'
import { Route as ticketsList } from '../tickets/index'

type Handler = (ctx: { request: Request; params: Record<string, string> }) => Promise<Response>
const handlers = (route: unknown) =>
  (route as { options: { server: { handlers: Record<string, Handler> } } }).options.server.handlers

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: helpCenterCategories.id }).from(helpCenterCategories).limit(0)
  },
})

let admin: PrincipalId

beforeEach(async () => {
  expect(fixture.available).toBe(true)
  await fixture.begin()
  const userId = createId('user') as UserId
  admin = createId('principal') as PrincipalId
  await testDb.insert(user).values({ id: userId, name: 'Ada', email: `${userId}@example.com` })
  await testDb
    .insert(principal)
    .values({ id: admin, userId, role: 'admin', type: 'user', createdAt: new Date() })
  auth.context = {
    apiKey: {
      id: 'api_key_test' as ApiKeyId,
      name: 'test',
      kind: 'workspace',
      keyPrefix: 'qb_',
      createdById: null,
      principalId: admin,
      lastUsedAt: null,
      expiresAt: null,
      createdAt: new Date(),
      revokedAt: null,
      scopes: null,
    },
    principalId: admin,
    role: 'admin',
    permissions: new Set(SYSTEM_ROLE_PERMISSIONS.owner),
    principal: null,
    importMode: false,
  } satisfies ApiAuthContext
})
afterEach(fixture.rollback)
afterAll(fixture.close)

/** Raw bytes, as a client that sends a broken body does. */
const NOT_JSON = '{"title": "x",'

async function call(
  route: unknown,
  method: string,
  path: string,
  opts: { params?: Record<string, string>; body?: string } = {}
): Promise<{ status: number; body: { error?: { code: string; message: string } } }> {
  const request = new Request(`http://t/api/v1/${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(opts.body !== undefined ? { body: opts.body } : {}),
  })
  const res = await handlers(route)[method]({ request, params: opts.params ?? {} })
  const text = await res.text()
  return { status: res.status, body: text ? JSON.parse(text) : {} }
}

describe('a body that is not JSON is a 400', () => {
  it.each([
    ['POST changelog', changelogList, 'changelog', {}],
    ['PATCH changelog entry', changelogEntry, 'changelog/x', { entryId: generateId('changelog') }],
    ['POST status services', servicesList, 'status/services', {}],
    ['POST status incidents', incidentsList, 'status/incidents', {}],
    ['POST help center categories', categoriesList, 'help-center/categories', {}],
    [
      'PATCH help center category',
      categoryOne,
      'help-center/categories/x',
      { categoryId: generateId('kb_category') },
    ],
    ['POST help center articles', articlesList, 'help-center/articles', {}],
  ])('%s', async (_name, route, path, params) => {
    const method = _name.split(' ')[0]!
    const res = await call(route, method, path, { params, body: NOT_JSON })
    expect(res.status, JSON.stringify(res.body)).toBe(400)
    expect(res.body.error?.message).toBe('Request body must be valid JSON')
  })
})

describe('a malformed cursor or id filter is a 400; a well-formed unknown one is not', () => {
  it.each([
    ['changelog', changelogList, 'changelog', 'changelog'],
    ['posts', postsList, 'posts', 'post'],
    ['status incidents', incidentsList, 'status/incidents', 'status_incident'],
    ['help center articles', articlesList, 'help-center/articles', 'article'],
  ] as const)('%s cursor', async (_name, route, path, prefix) => {
    const bad = await call(route, 'GET', `${path}?cursor=not-an-id&limit=2`)
    expect(bad.status, JSON.stringify(bad.body)).toBe(400)
    expect(bad.body.error?.message).toMatch(/cursor/i)
    const unknown = await call(route, 'GET', `${path}?cursor=${generateId(prefix)}`)
    expect(unknown.status, JSON.stringify(unknown.body)).toBe(200)
  })

  it.each([
    ['help center articles categoryId', articlesList, 'help-center/articles?categoryId=garbage'],
    [
      'conversations assignedAgentPrincipalId',
      conversationsList,
      'conversations?assignedAgentPrincipalId=garbage',
    ],
    ['tickets requesterPrincipalId', ticketsList, 'tickets?requesterPrincipalId=garbage'],
    ['tickets companyId', ticketsList, 'tickets?companyId=garbage'],
  ])('%s', async (_name, route, path) => {
    const res = await call(route, 'GET', path)
    expect(res.status, JSON.stringify(res.body)).toBe(400)
  })
})

describe('limit is a whole number from 1; above the cap it is capped', () => {
  it.each(['0', '-1', 'abc', '2.5'])('changelog ?limit=%s is a 400', async (limit) => {
    const res = await call(changelogList, 'GET', `changelog?limit=${limit}`)
    expect(res.status, JSON.stringify(res.body)).toBe(400)
    expect(res.body.error?.message).toMatch(/limit/)
  })

  it.each([
    ['changelog', changelogList],
    ['posts', postsList],
    ['status/incidents', incidentsList],
    ['help-center/articles', articlesList],
    ['conversations', conversationsList],
  ] as const)('%s refuses limit=0 and caps limit=500', async (path, route) => {
    expect((await call(route, 'GET', `${path}?limit=0`)).status).toBe(400)
    expect((await call(route, 'GET', `${path}?limit=500`)).status).toBe(200)
  })

  it('tickets refuses limit=0', async () => {
    expect((await call(ticketsList, 'GET', 'tickets?limit=0')).status).toBe(400)
  })
})

describe('help center references', () => {
  it.each(['garbage', generateId('kb_category')])(
    'an article in category %s is refused, not a server error',
    async (categoryId) => {
      const res = await call(articlesList, 'POST', 'help-center/articles', {
        body: JSON.stringify({ categoryId, title: 'Orphan', content: 'x', authorId: admin }),
      })
      expect(res.status, JSON.stringify(res.body)).toBe(400)
    }
  )

  it('moving an article to an unknown category is refused', async () => {
    const [cat] = await testDb
      .insert(helpCenterCategories)
      .values({ name: 'Docs', slug: 'docs' })
      .returning()
    const created = await call(articlesList, 'POST', 'help-center/articles', {
      body: JSON.stringify({ categoryId: cat!.id, title: 'Setup', content: 'x', authorId: admin }),
    })
    expect(created.status).toBe(201)
    const articleId = (created.body as unknown as { data: { id: string } }).data.id
    for (const categoryId of ['garbage', generateId('kb_category')]) {
      const res = await call(articleOne, 'PATCH', 'help-center/articles/x', {
        params: { articleId },
        body: JSON.stringify({ categoryId }),
      })
      expect(res.status, JSON.stringify(res.body)).toBe(400)
    }
  })

  it('feedback for an unknown article is not found', async () => {
    const res = await call(articleFeedback, 'POST', 'help-center/articles/x/feedback', {
      params: { articleId: generateId('article') },
      body: JSON.stringify({ helpful: true }),
    })
    expect(res.status, JSON.stringify(res.body)).toBe(404)
    expect(res.body.error?.message).toBe('Help center article not found')
  })
})

describe('the services path names a service', () => {
  it('in its malformed-id and not-found errors', async () => {
    const bad = await call(serviceOne, 'GET', 'status/services/nope', {
      params: { serviceId: 'nope' },
    })
    expect(bad.status).toBe(400)
    expect(bad.body.error?.message).toMatch(/service/i)
    const missing = await call(serviceOne, 'GET', 'status/services/x', {
      params: { serviceId: generateId('status_component') },
    })
    expect(missing.status).toBe(404)
    expect(missing.body.error?.message).toMatch(/service/i)
  })
})
