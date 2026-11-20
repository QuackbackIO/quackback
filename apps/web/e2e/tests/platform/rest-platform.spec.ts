/**
 * The platform routes around the REST API: the operator usage endpoint, the
 * first-run setup endpoint, file uploads, the OpenAPI document and the docs
 * page.
 *
 * Journeys: API-R-180, API-R-181, API-R-182, API-R-183, API-R-184.
 *
 * Not here: API-R-180 with ADMIN_API_TOKEN set (the suite's app runs without
 * it, and setting it changes the server for every test) and API-R-181's
 * fresh-install outcomes (need an empty database).
 */
import { test, expect } from '../../support/fixtures'
import { apiFor, expectJson } from '../../support/api-client'
import { adminApi, missingScope } from '../../product/api-rest-content'

test.describe.configure({ timeout: 60_000 })

// A 1x1 transparent PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
)

test(
  'API-R-180 the usage endpoint is not routed while no operator token is configured',
  { tag: '@nightly' },
  async ({ playwright, baseURL, people }) => {
    const { api, key } = await adminApi(playwright, baseURL, people)
    for (const headers of [{}, { authorization: `Bearer ${key}` }]) {
      const res = await api.get('/api/v1/admin/usage', { headers })
      expect(res.status()).toBe(404)
      expect(await res.text()).toBe('Not Found')
    }
    await api.dispose()
  }
)

test(
  'API-R-181 setup after the first admin is not found, and the endpoint is rate limited per address',
  { tag: '@nightly' },
  async ({ playwright, baseURL }) => {
    const api = await apiFor(playwright, baseURL, null)
    const first = await expectJson(
      await api.post('/api/v1/setup', {
        headers: { authorization: 'Bearer any-setup-token' },
        data: {},
      }),
      404
    )
    expect(first.error).toMatchObject({ code: 'NOT_FOUND', message: 'Endpoint not found' })
    const statuses: number[] = [404]
    let limited = null
    for (let i = 0; i < 12 && !limited; i++) {
      const res = await api.post('/api/v1/setup', { data: {} })
      statuses.push(res.status())
      if (res.status() === 429) limited = res
    }
    expect(statuses.slice(0, 10).every((s) => s === 404)).toBe(true)
    expect(limited, statuses.join(',')).not.toBeNull()
    expect(statuses.indexOf(429)).toBe(10)
    const body = await limited!.json()
    expect(body.error.code).toBe('RATE_LIMITED')
    expect(Number(limited!.headers()['retry-after'])).toBeGreaterThan(0)
    // Another address is not limited.
    const other = await apiFor(playwright, baseURL, null)
    expect((await other.post('/api/v1/setup', { data: {} })).status()).toBe(404)
    await other.dispose()
    await api.dispose()
  }
)

test(
  'API-R-182 a file upload needs write:chat; a chat key stores it',
  { tag: '@nightly' },
  async ({ playwright, baseURL, people }) => {
    const { api: content } = await adminApi(playwright, baseURL, people, {
      scopes: [
        'read:feedback',
        'write:feedback',
        'write:changelog',
        'read:article',
        'write:article',
      ],
    })
    const { api: chat } = await adminApi(playwright, baseURL, people, {
      scopes: ['read:chat', 'write:chat'],
    })
    const upload = (api: typeof chat) =>
      api.post('/api/v1/files?name=hero.png', {
        data: PNG,
        headers: { 'content-type': 'image/png' },
      })
    const refused = await expectJson(await upload(content), 403)
    expect(refused.error).toMatchObject({
      code: 'FORBIDDEN',
      message: missingScope('write:chat', 'conversation.reply'),
    })
    const stored = await expectJson(await upload(chat), 201)
    expect(Object.keys(stored.data).sort()).toEqual(
      ['contentType', 'family', 'fileId', 'name', 'size', 'url'].sort()
    )
    expect(stored.data).toMatchObject({
      name: 'hero.png',
      contentType: 'image/png',
      size: PNG.length,
    })
    for (const api of [content, chat]) await api.dispose()
  }
)

test(
  'API-R-183 the OpenAPI document is public, cached, and documents the status routes',
  { tag: '@nightly' },
  async ({ playwright, baseURL }) => {
    const api = await apiFor(playwright, baseURL, null)
    const res = await api.get('/api/v1/openapi/json')
    expect(res.status()).toBe(200)
    expect(res.headers()['cache-control']).toBe('public, max-age=3600')
    expect(res.headers()['vary']).toContain('Host')
    const spec = await res.json()
    expect(spec.openapi).toMatch(/^3\.1/)
    for (const path of [
      '/changelog',
      '/status/services',
      '/status/incidents',
      '/help-center/articles',
      '/settings',
    ]) {
      expect(
        Object.keys(spec.paths).some((p) => p.endsWith(path)),
        path
      ).toBe(true)
    }
    const components = Object.entries(spec.paths).filter(([p]) => p.includes('/status/components'))
    expect(components.length).toBeGreaterThan(0)
    for (const [, ops] of components) {
      for (const op of Object.values(ops as Record<string, { deprecated?: boolean }>)) {
        expect(op.deprecated).toBe(true)
      }
    }
    expect((await api.get('/api/v1/openapi.json')).status()).toBe(404)
    await api.dispose()
  }
)

test(
  'API-R-184 the docs page loads the spec in Swagger UI',
  { tag: '@nightly' },
  async ({ page }) => {
    const specRequest = page.waitForRequest((r) => r.url().includes('/api/v1/openapi/json'))
    const res = await page.goto('/api/v1/docs')
    expect(res?.status()).toBe(200)
    await expect(page).toHaveTitle('API Reference | Quackback')
    await specRequest
    await expect(page.locator('.swagger-ui .opblock').first()).toBeVisible({ timeout: 20_000 })
  }
)
