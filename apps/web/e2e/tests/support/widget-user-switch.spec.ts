/**
 * Signing out of the widget and switching users (area CUS-W, S series): a
 * host page loads the real SDK and drives it the way an app does when its
 * signed-in user changes.
 *
 * Each test identifies customers it minted itself, each with a conversation
 * only they can see, so "whose conversations does the widget show" tells
 * who the widget is acting as. Identify is limited per client IP, so every
 * identify resets that budget first.
 */
import { randomBytes } from 'node:crypto'
import type { APIRequestContext, Page, Route } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { supportEnv } from '../../support/env'
import {
  mintCustomer,
  mintSessionToken,
  resetIdentifyBudget,
  signSsoToken,
  visitorSend,
  widgetSecret,
  widgetTab,
} from '../../support/widget-portal'

interface Person {
  ssoToken: string
  opening: string
  email: string
}

/** A customer with one conversation of their own, and a token to identify as them. */
async function personWithConversation(
  request: APIRequestContext,
  marker: string,
  label: string
): Promise<Person> {
  const email = `${marker}-${label}@customers.example`
  const externalId = `${label}-${marker}`
  const customer = await mintCustomer({ email, externalId, name: `Customer ${label}` })
  const opening = `${marker} ${label} private question`
  await visitorSend(request, await mintSessionToken(customer.userUuid), opening)
  const secret = await widgetSecret(request)
  return { ssoToken: signSsoToken({ id: externalId, email }, secret), opening, email }
}

type QuackbackCall = (command: string, arg?: unknown) => unknown

/**
 * A host page that loads the real SDK without identifying anyone. Every
 * identify event the SDK fires is kept in `window.identifyEvents`.
 */
async function openHost(page: Page) {
  const env = supportEnv()
  const path = `/e2e/host-${randomBytes(6).toString('hex')}`
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>host</title></head>
<body><h1>Widget host</h1>
<script src="/api/widget/sdk.js"></script>
<script>
  window.identifyEvents = []
  window.Quackback('on', 'identify', function (ev) { window.identifyEvents.push(ev) })
  window.Quackback('init', ${JSON.stringify({ instanceUrl: env.baseUrl })})
</script></body></html>`
  await page.route(`${env.baseUrl}${path}`, (route) =>
    route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: html })
  )
  await page.goto(path)
  return page.frameLocator('iframe.quackback-widget-iframe')
}

/** Call the SDK on the host page, as the host app would. */
async function sdk(page: Page, command: string, arg?: unknown): Promise<unknown> {
  return page.evaluate(
    ([c, a]) => (window as unknown as { Quackback: QuackbackCall }).Quackback(c as string, a),
    [command, arg] as const
  )
}

async function identify(page: Page, ssoToken: string) {
  await resetIdentifyBudget()
  await sdk(page, 'identify', { ssoToken })
}

const lastIdentifyEvent = (page: Page) =>
  page.evaluate(
    () =>
      (
        window as unknown as {
          identifyEvents: { success: boolean; user: { email?: string } | null; error?: string }[]
        }
      ).identifyEvents.at(-1) ?? null
  )

const currentEmail = async (page: Page) =>
  ((await sdk(page, 'getUser')) as { email?: string } | null)?.email ?? null

/** Wait until the SDK reports this person (or nobody, for null). */
async function expectUser(page: Page, email: string | null) {
  await expect.poll(() => currentEmail(page), { timeout: 20_000 }).toBe(email)
}

/**
 * Hold identify requests for one person until `release()`, so a test can act
 * while that round trip is still on its way.
 */
async function holdIdentify(page: Page, person: Person) {
  let release!: () => void
  const released = new Promise<void>((resolve) => (release = resolve))
  let seen!: () => void
  const arrived = new Promise<void>((resolve) => (seen = resolve))
  const handler = async (route: Route) => {
    const body = route.request().postData() ?? ''
    if (!body.includes(person.ssoToken)) return route.fallback()
    seen()
    await released
    // The request reaches the server only now, so its answer lands last.
    const response = await route.fetch()
    await route.fulfill({ response })
  }
  await page.route('**/api/widget/identify', handler)
  return {
    arrived,
    release: async () => {
      const answered = page.waitForResponse(
        (res) =>
          res.url().includes('/api/widget/identify') &&
          (res.request().postData() ?? '').includes(person.ssoToken)
      )
      release()
      await answered
    },
  }
}

/** Open the widget on Messages and expect exactly this person's conversation. */
async function expectConversations(
  page: Page,
  widget: ReturnType<Page['frameLocator']>,
  shown: Person | null,
  hidden: Person[]
) {
  await sdk(page, 'open')
  await widgetTab(widget, 'Messages').click()
  if (shown) {
    await expect(widget.getByRole('button', { name: new RegExp(shown.opening) })).toBeVisible({
      timeout: 15_000,
    })
  } else {
    await expect(widget.getByText('No conversations yet')).toBeVisible({ timeout: 15_000 })
  }
  for (const other of hidden) {
    await expect(widget.getByText(other.opening)).toHaveCount(0)
  }
}

test.describe('widget identity: signing out and switching users', () => {
  test(
    'CUS-W-S1 logout then identify shows only the next person, with the panel closed in between',
    { tag: '@core' },
    async ({ page, request, marker }) => {
      const a = await personWithConversation(request, marker, 'a')
      const b = await personWithConversation(request, marker, 'b')
      const widget = await openHost(page)

      await identify(page, a.ssoToken)
      await expectUser(page, a.email)
      await expectConversations(page, widget, a, [])
      expect(await sdk(page, 'isOpen')).toBe(true)

      await sdk(page, 'logout')
      expect(await sdk(page, 'isOpen')).toBe(false)
      expect(await currentEmail(page)).toBeNull()
      await expectConversations(page, widget, null, [a])

      await sdk(page, 'close')
      await identify(page, b.ssoToken)
      await expectUser(page, b.email)
      await expectConversations(page, widget, b, [a])
    }
  )

  test(
    'CUS-W-S2 a logout while a sign-in is still on its way stays logged out',
    { tag: '@core' },
    async ({ page, request, marker }) => {
      const a = await personWithConversation(request, marker, 'a')
      const widget = await openHost(page)
      const held = await holdIdentify(page, a)

      await identify(page, a.ssoToken)
      await held.arrived
      await sdk(page, 'logout')
      await held.release()

      // The late answer for A is dropped: the SDK and the frame stay signed out.
      await expect.poll(() => lastIdentifyEvent(page)).toMatchObject({ success: true, user: null })
      await page.waitForTimeout(1_000)
      expect(await currentEmail(page)).toBeNull()
      await expectConversations(page, widget, null, [a])
    }
  )

  test(
    'CUS-W-S3 switching users keeps the newer person when the earlier sign-in answers last',
    { tag: '@nightly' },
    async ({ page, request, marker }) => {
      const a = await personWithConversation(request, marker, 'a')
      const b = await personWithConversation(request, marker, 'b')
      const widget = await openHost(page)
      const held = await holdIdentify(page, a)

      await identify(page, a.ssoToken)
      await held.arrived
      await sdk(page, 'logout')
      await identify(page, b.ssoToken)
      await expectUser(page, b.email)
      await held.release()

      await page.waitForTimeout(1_000)
      expect(await currentEmail(page)).toBe(b.email)
      await expectConversations(page, widget, b, [a])
    }
  )

  test(
    'CUS-W-S4 a failed sign-in for the next person signs the previous one out',
    { tag: '@nightly' },
    async ({ page, request, marker }) => {
      const a = await personWithConversation(request, marker, 'a')
      const widget = await openHost(page)

      await identify(page, a.ssoToken)
      await expectUser(page, a.email)
      await expectConversations(page, widget, a, [])
      await sdk(page, 'close')

      // An expired token for someone else: the host forgot to log out first.
      const secret = await widgetSecret(request)
      const expired = signSsoToken(
        { id: `b-${marker}`, email: `${marker}-b@customers.example` },
        secret,
        -60
      )
      await identify(page, expired)
      await expect
        .poll(() => lastIdentifyEvent(page))
        .toMatchObject({ success: false, error: 'TOKEN_INVALID' })
      expect(await currentEmail(page)).toBeNull()
      await expectConversations(page, widget, null, [a])
    }
  )

  test(
    'CUS-W-S5 after destroy and init for the next person, another frame on the instance cannot change the user',
    { tag: '@nightly' },
    async ({ page, request, marker }) => {
      const a = await personWithConversation(request, marker, 'a')
      const b = await personWithConversation(request, marker, 'b')
      const env = supportEnv()
      await openHost(page)
      await identify(page, a.ssoToken)
      await expectUser(page, a.email)

      // The app's own switch: tear the widget down and start it for B.
      await sdk(page, 'destroy')
      await sdk(page, 'init', { instanceUrl: env.baseUrl })
      await identify(page, b.ssoToken)
      await expectUser(page, b.email)

      // A page on the instance origin that is not the panel (a removed panel's
      // last word, a second embed, a popup) reports A as the signed-in user.
      const rogue = `/e2e/rogue-${randomBytes(6).toString('hex')}`
      await page.route(`${env.baseUrl}${rogue}`, (route) =>
        route.fulfill({
          status: 200,
          contentType: 'text/html; charset=utf-8',
          body: `<!doctype html><script>
            parent.postMessage({ type: 'quackback:identify-result', success: true,
              user: { id: 'user_rogue', email: ${JSON.stringify(a.email)}, name: 'A' } }, '*')
          </script>`,
        })
      )
      const posted = page.waitForResponse((res) => res.url().endsWith(rogue))
      await page.evaluate((src) => {
        const frame = document.createElement('iframe')
        frame.src = src
        document.body.appendChild(frame)
      }, rogue)
      await posted
      await page.waitForTimeout(1_000)

      expect(await currentEmail(page)).toBe(b.email)
      await expectConversations(page, page.frameLocator('iframe.quackback-widget-iframe'), b, [a])
    }
  )
})
