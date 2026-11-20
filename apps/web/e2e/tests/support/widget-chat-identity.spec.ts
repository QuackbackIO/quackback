/**
 * Who the widget visitor is (area CUS-W): config and SDK, anonymous
 * sessions, verified identify, merges, blocks, teammates, and the handoff to
 * the portal.
 *
 * Identify is limited per client IP and every test client is 127.0.0.1, so
 * each identify test resets that budget first (resetIdentifyBudget); the
 * limiter itself is not tested here.
 */
import { toUuid } from '@quackback/ids'
import type { APIRequestContext } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { pollFor, supportDb } from '../../support/db'
import {
  callServerFn,
  conversationCount,
  FN_FILES,
  mintCustomer,
  mintVisitor,
  openWidget,
  openWidgetThread,
  resetIdentifyBudget,
  signSsoToken,
  visitorSend,
  widgetFn,
  widgetSecret,
  widgetTab,
} from '../../support/widget-portal'

interface IdentifyJson {
  sessionToken?: string
  user?: { id: string; email: string; name: string }
  canPortalHandoff?: boolean
  error?: { code: string; message: string }
}

async function identify(
  request: APIRequestContext,
  body: Record<string, unknown>,
  bearer?: string
) {
  await resetIdentifyBudget()
  const res = await request.post('/api/widget/identify', {
    data: body,
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  })
  return { res, json: (await res.json().catch(() => null)) as IdentifyJson | null }
}

test.describe('widget identity: config, SDK and sessions', () => {
  test(
    'CUS-W-01 the enabled widget config is public, cacheable for an hour and open to any origin',
    { tag: '@core' },
    async ({ request }) => {
      const res = await request.get('/api/widget/config.json', {
        headers: { origin: 'https://customer-site.example' },
      })
      expect(res.status()).toBe(200)
      expect(res.headers()['access-control-allow-origin']).toBe('*')
      expect(res.headers()['cache-control']).toMatch(/public/)
      expect(res.headers()['cache-control']).toMatch(/max-age=3600/)
      const body = await res.json()
      expect(body.enabled).not.toBe(false)
      expect(JSON.stringify(body)).not.toMatch(/widgetSecret|routing/)
    }
  )

  test(
    'CUS-W-02 the SDK script is served as JavaScript with Vary: Accept-Encoding and cache headers',
    { tag: '@nightly' },
    async ({ request }) => {
      const res = await request.get('/api/widget/sdk.js')
      expect(res.status()).toBe(200)
      expect(res.headers()['content-type']).toMatch(/javascript/)
      expect(res.headers()['vary']).toMatch(/Accept-Encoding/i)
      expect(res.headers()['cache-control']).toMatch(/max-age=\d+/)
      expect(await res.text()).toContain('Quackback')
    }
  )

  test(
    'CUS-W-03 an anonymous sign-in returns a token that works as a Bearer, for an anonymous principal with a synthetic email',
    { tag: '@core' },
    async ({ playwright, baseURL, marker }) => {
      // A cookie-less client, as the widget calls it (credentials: 'omit').
      const api = await playwright.request.newContext({ baseURL })
      const res = await api.post('/api/auth/sign-in/anonymous', {
        data: {},
        headers: { origin: baseURL! },
      })
      expect(res.status()).toBe(200)
      const token = res.headers()['set-auth-token']
      expect(token).toBeTruthy()

      const sent = await visitorSend(api, token, `${marker} anonymous hello`)
      const [row] = await supportDb()`SELECT u.email, u.is_anonymous, p.type FROM conversations c
        JOIN principal p ON p.id = c.visitor_principal_id JOIN "user" u ON u.id = p.user_id
        WHERE c.id = ${toUuid(sent.conversation.id as `conversation_${string}`)}`
      expect(row.type).toBe('anonymous')
      expect(row.email).toMatch(/^temp-.+@anon/)
      expect(row.is_anonymous).toBe(true)
      await api.dispose()
    }
  )

  test(
    'CUS-W-55 the device ping answers 401 without a session and 204 with one, even for a bad body',
    { tag: '@nightly' },
    async ({ request }) => {
      const visitor = await mintVisitor()
      expect((await request.post('/api/widget/device', { data: {} })).status()).toBe(401)
      const bad = await request.post('/api/widget/device', {
        headers: { authorization: `Bearer ${visitor.token}` },
        data: { nonsense: true },
      })
      expect(bad.status()).toBe(204)
    }
  )

  test(
    'CUS-W-54 an install pairing code that is wrong answers CODE_INVALID, a short one a validation error',
    { tag: '@nightly' },
    async ({ request }) => {
      const wrong = await request.post('/api/widget/install-context', {
        data: { code: 'NOTAREALCODE123' },
      })
      expect(wrong.status()).toBe(404)
      expect((await wrong.json()).error.code).toBe('CODE_INVALID')
      const short = await request.post('/api/widget/install-context', { data: { code: 'abc' } })
      expect(short.status()).toBe(400)
    }
  )
})

test.describe('widget identity: verified identify', () => {
  test(
    'CUS-W-06 a signed ssoToken mints a session with no cookie and matches the same user by email case and externalId',
    { tag: '@core' },
    async ({ request, customerEmail, marker }) => {
      const secret = await widgetSecret(request)
      const sub = `ext-${marker}`
      const first = await identify(request, {
        ssoToken: signSsoToken({ id: sub, email: customerEmail, name: 'Ida Identify' }, secret),
      })
      expect(first.res.status()).toBe(200)
      expect(first.res.headers()['set-cookie']).toBeUndefined()
      expect(first.json).toMatchObject({
        sessionToken: expect.any(String),
        user: { email: customerEmail, name: 'Ida Identify' },
        canPortalHandoff: true,
      })

      const upper = await identify(request, {
        ssoToken: signSsoToken({ id: sub, email: customerEmail.toUpperCase() }, secret),
      })
      expect(upper.json?.user?.id).toBe(first.json?.user?.id)
      const [{ n }] = await supportDb()`SELECT count(*)::int AS n FROM "user"
        WHERE lower(email) = lower(${customerEmail})`
      expect(n).toBe(1)

      const [verified] = await supportDb()`SELECT w.hmac_verified FROM widget_identified_session w
        JOIN session s ON s.id = w.session_id
        WHERE s.user_id = ${toUuid(first.json!.user!.id as `user_${string}`)} LIMIT 1`
      expect(verified?.hmac_verified).toBe(true)

      // The minted token is a working widget session.
      const mine = await widgetFn(request, 'widgetGetMyConversationsFn', {
        bearer: first.json!.sessionToken,
      })
      expect(mine.error).toBeUndefined()
    }
  )

  test(
    'CUS-W-07 a bad signature, an expired token and missing claims are refused',
    { tag: '@nightly' },
    async ({ request, customerEmail, marker }) => {
      const secret = await widgetSecret(request)
      const bad = await identify(request, {
        ssoToken: signSsoToken({ id: marker, email: customerEmail }, 'not-the-secret'),
      })
      expect(bad.res.status()).toBe(403)
      expect(bad.json?.error?.code).toBe('TOKEN_INVALID')
      const expired = await identify(request, {
        ssoToken: signSsoToken({ id: marker, email: customerEmail }, secret, -60),
      })
      expect(expired.res.status()).toBe(403)
      expect(expired.json?.error?.code).toBe('TOKEN_INVALID')
      const noEmail = await identify(request, {
        ssoToken: signSsoToken({ id: marker, email: undefined as unknown as string }, secret),
      })
      expect(noEmail.res.status()).toBe(400)
      expect(noEmail.json?.error?.code).toBe('TOKEN_INVALID')
      const noBody = await identify(request, {})
      expect(noBody.res.status()).toBe(400)
      expect(noBody.json?.error?.code).toBe('VALIDATION_ERROR')
    }
  )

  test(
    'CUS-W-08 an email bound to another account is refused with EMAIL_IN_USE and no session',
    { tag: '@core' },
    async ({ request, customerEmail, marker }) => {
      await mintCustomer({ email: customerEmail, externalId: `holder-${marker}` })
      const secret = await widgetSecret(request)
      const res = await identify(request, {
        ssoToken: signSsoToken({ id: `other-${marker}`, email: customerEmail }, secret),
      })
      expect(res.res.status()).toBe(409)
      expect(res.json?.error).toEqual({
        code: 'EMAIL_IN_USE',
        message: 'This email is already bound to another account',
      })
      expect(res.json?.sessionToken).toBeUndefined()
      const [{ n }] =
        await supportDb()`SELECT count(*)::int AS n FROM "user" WHERE external_id = ${`other-${marker}`}`
      expect(n).toBe(0)
    }
  )

  test(
    'CUS-W-10 a blocked person cannot identify, including a block inherited through the anonymous merge',
    { tag: '@core' },
    async ({ request, customerEmail, marker }) => {
      const secret = await widgetSecret(request)
      const blocked = await mintCustomer({ email: customerEmail, externalId: `blocked-${marker}` })
      await supportDb()`UPDATE principal SET blocked_at = NOW() WHERE id = ${blocked.principalUuid}`
      const direct = await identify(request, {
        ssoToken: signSsoToken({ id: `blocked-${marker}`, email: customerEmail }, secret),
      })
      expect(direct.res.status()).toBe(403)
      expect(direct.json?.error).toEqual({ code: 'BLOCKED', message: 'This account is blocked.' })

      // A blocked anonymous visitor identifying as someone new.
      const anon = await mintVisitor()
      await supportDb()`UPDATE principal SET blocked_at = NOW() WHERE id = ${anon.principalUuid}`
      const merged = await identify(
        request,
        {
          ssoToken: signSsoToken(
            { id: `fresh-${marker}`, email: `fresh-${customerEmail}` },
            secret
          ),
          previousToken: anon.token,
        },
        anon.token
      )
      expect(merged.res.status()).toBe(403)
      expect(merged.json?.error?.code).toBe('BLOCKED')
      expect(merged.json?.sessionToken).toBeUndefined()
    }
  )

  test(
    'CUS-W-11 a teammate identified in the widget gets no portal handoff and no team powers',
    { tag: '@core' },
    async ({ request, marker }) => {
      const secret = await widgetSecret(request)
      const { json } = await identify(request, {
        ssoToken: signSsoToken(
          { id: `tm-${marker}`, email: 'e2e-support-agent-b@example.com' },
          secret
        ),
      })
      expect(json?.canPortalHandoff).toBe(false)
      const token = json!.sessionToken as string
      const session = await request.get('/api/widget/session', {
        headers: { authorization: `Bearer ${token}` },
      })
      expect(session.status()).toBe(200)
      expect((await session.json()).data.canPortalHandoff).toBe(false)

      // The widget token cannot reach a team action.
      const visitor = await mintVisitor()
      const { conversation } = await visitorSend(request, visitor.token, `${marker} customer`)
      const reply = await callServerFn(request, FN_FILES.conversation, 'sendAgentMessageFn', {
        bearer: token,
        data: { conversationId: conversation.id, content: `${marker} as a teammate via widget` },
      })
      expect(reply.error).toBeDefined()
      const [{ n }] = await supportDb()`SELECT count(*)::int AS n FROM conversation_messages
        WHERE content = ${`${marker} as a teammate via widget`}`
      expect(n).toBe(0)
    }
  )
})

test.describe('widget identity: in the browser', () => {
  test(
    'CUS-W-09 an anonymous visitor who then identifies keeps their conversation, and the anonymous token is dropped',
    { tag: '@core' },
    async ({ page, request, customerEmail, marker }) => {
      const visitor = await mintVisitor()
      const opening = `${marker} before I logged in`
      const { conversation } = await visitorSend(request, visitor.token, opening)
      const widget = await openWidget(page, { visitorToken: visitor.token })
      await openWidgetThread(widget, opening)
      await expect(widget.getByText(opening)).toBeVisible({ timeout: 15_000 })

      // The host app signs the visitor in.
      const secret = await widgetSecret(request)
      const ssoToken = signSsoToken(
        { id: `merge-${marker}`, email: customerEmail, name: 'Mo Merge' },
        secret
      )
      await resetIdentifyBudget()
      await page.evaluate((t) => {
        const q = (window as unknown as { Quackback: (c: string, a?: unknown) => void }).Quackback
        q('identify', { ssoToken: t })
      }, ssoToken)
      await expect(page.locator('html')).toHaveAttribute('data-identified', '1', {
        timeout: 20_000,
      })

      const owner = await pollFor('the conversation to move', async () => {
        const [row] = await supportDb()`SELECT u.email FROM conversations c
          JOIN principal p ON p.id = c.visitor_principal_id JOIN "user" u ON u.id = p.user_id
          WHERE c.id = ${toUuid(conversation.id as `conversation_${string}`)}`
        return row.email === customerEmail ? row : null
      })
      expect(owner.email).toBe(customerEmail)
      expect(await conversationCount(visitor.principalUuid)).toBe(0)

      await page.reload()
      const again = await openWidget(page, {
        ssoToken: signSsoToken({ id: `merge-${marker}`, email: customerEmail }, secret),
      })
      await widgetTab(again, 'Messages').click()
      await expect(again.getByRole('button', { name: new RegExp(opening) })).toBeVisible({
        timeout: 15_000,
      })
      const stored = await page
        .frameLocator('iframe.quackback-widget-iframe')
        .locator('body')
        .evaluate(() =>
          Object.keys(window.localStorage).filter((k) => k.startsWith('quackback:anon-token:'))
        )
      expect(stored).toEqual([])
    }
  )

  test(
    'CUS-W-56 the widget-to-portal handoff lands signed in on the portal at returnTo; a missing token lands on invalid',
    { tag: '@core' },
    async ({ page, request, customerEmail, marker }) => {
      // The "Portal" button itself shows only on a private portal with widget
      // sign-in (a workspace setting); this drives the same one-time-token
      // handoff it opens.
      const secret = await widgetSecret(request)
      const { json } = await identify(request, {
        ssoToken: signSsoToken({ id: `portal-${marker}`, email: customerEmail }, secret),
      })
      const minted = await request.get('/api/auth/one-time-token/generate', {
        headers: { authorization: `Bearer ${json!.sessionToken}` },
      })
      expect(minted.status()).toBe(200)
      const { token: ott } = (await minted.json()) as { token: string }
      await page.goto(`/auth/widget-handoff?ott=${encodeURIComponent(ott)}&returnTo=%2Fsupport`)
      await expect(page).toHaveURL(/\/support$/, { timeout: 20_000 })
      const session = await page.request.get('/api/auth/get-session')
      expect((await session.json())?.user?.email).toBe(customerEmail)

      const missing = await page.context().newPage()
      await missing.goto('/auth/widget-handoff')
      await expect(missing.getByText('Sign-in link expired')).toBeVisible({ timeout: 15_000 })
    }
  )
})
