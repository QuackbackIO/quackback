/**
 * The private portal gate, sign-in side. Every test is `@isolated`: a private
 * portal hides the portal from every other test while it is on.
 *
 * Journeys: PPL-AUTH-61, 62, 63, 65, 66.
 */
import { fromUuid } from '@quackback/ids'
import { ISOLATED, ISOLATED_SKIP } from '../../support/automation'
import { supportDb } from '../../support/db'
import { personApi, callServerFn } from '../../support/server-fns'
import { mintSession } from '../../support/teammates'
import {
  audits,
  expect,
  portalUser,
  test,
  userRow,
  visitorContext,
  withAuthSettings,
} from '../../product/auth'

test.beforeEach(() => {
  test.skip(!ISOLATED, ISOLATED_SKIP)
})

const PRIVATE = { portal_config: { 'access.visibility': 'private' } }
const NOT_LISTED = "this account isn't on the access list for this private portal."

async function signedInPage(browser: import('@playwright/test').Browser, userUuid: string) {
  const context = await visitorContext(browser, {
    storageState: await mintSession(fromUuid('user', userUuid)),
  })
  return context.newPage()
}

test(
  'PPL-AUTH-61 an anonymous visitor meets the sign-in gate',
  { tag: ['@core', '@isolated'] },
  async ({ visitor }) => {
    await withAuthSettings(PRIVATE, async () => {
      const since = new Date()
      const page = await visitor()
      await page.goto('/roadmap')
      await expect(
        page.getByText('This portal is private. Sign in or create an account to continue.')
      ).toBeVisible()
      await expect(page.locator('#inline-email')).toBeVisible()
      await expect(page.getByRole('navigation').getByText('Roadmap')).toHaveCount(0)
      expect(await audits('portal.access.denied', { since })).toHaveLength(0)
    })
  }
)

test(
  'PPL-AUTH-62 a signed-in person not on the list is told so, and can sign out',
  { tag: ['@core', '@isolated'] },
  async ({ browser, playwright, customerEmail }) => {
    const person = await portalUser(playwright, customerEmail)
    await withAuthSettings(PRIVATE, async () => {
      const since = new Date()
      const page = await signedInPage(browser, person.userId)
      await page.goto('/')
      await expect(page.getByText("You don't have access")).toBeVisible()
      await expect(
        page.getByText(`You're signed in as ${customerEmail}, but ${NOT_LISTED}`)
      ).toBeVisible()
      await expect
        .poll(
          async () => (await audits('portal.access.denied', { email: customerEmail, since })).length
        )
        .toBeGreaterThan(0)
      const [denied] = await audits('portal.access.denied', { email: customerEmail, since })
      expect(denied.event_outcome).toBe('failure')
      expect(denied.metadata).toMatchObject({ reason: 'unauthorized' })

      const count = async () =>
        (
          await supportDb()`SELECT count(*)::int AS n FROM session WHERE user_id = ${person.userId}`
        )[0].n as number
      const before = await count()
      // The gate is server-rendered; wait for it to hydrate before pressing.
      await page.waitForLoadState('networkidle')
      await page.getByRole('button', { name: 'Sign out' }).click()
      await expect(page.locator('#inline-email')).toBeVisible()
      expect(await count()).toBe(before - 1)
      await page.context().close()
    })
  }
)

test(
  'PPL-AUTH-63 a verified address at an allowed domain gets in; another domain does not',
  { tag: ['@core', '@isolated'] },
  async ({ browser, playwright, marker }) => {
    const domain = `${marker.replace(/[^a-z0-9]+/g, '-').slice(-30)}.allowed-e2e.com`
    const inside = await portalUser(playwright, `a@${domain}`)
    const outside = await portalUser(playwright, `${marker}@customers.example`)
    await supportDb()`UPDATE "user" SET email_verified = true WHERE id IN (${inside.userId}, ${outside.userId})`
    await withAuthSettings(
      { portal_config: { 'access.visibility': 'private', 'access.allowedDomains': [domain] } },
      async () => {
        const inPage = await signedInPage(browser, inside.userId)
        await inPage.goto('/')
        await expect(inPage.getByRole('button', { name: 'Open account menu' })).toBeVisible()
        await expect(inPage.getByText("You don't have access")).toHaveCount(0)
        const html = await inPage.content()
        expect(html).not.toContain(domain.split('.')[0] + '.allowed-e2e.com"')

        const outPage = await signedInPage(browser, outside.userId)
        await outPage.goto('/')
        await expect(outPage.getByText("You don't have access")).toBeVisible()
        await inPage.context().close()
        await outPage.context().close()
      }
    )
  }
)

test(
  'PPL-AUTH-65 a teammate gets in on a dashboard session but not on a portal-scope one',
  { tag: ['@nightly', '@isolated'] },
  async ({ browser, newTeammate }) => {
    const mate = await newTeammate({ roleKey: 'support_lead' })
    const user = await userRow(mate.email)
    await withAuthSettings(PRIVATE, async () => {
      const dash = await signedInPage(browser, user!.id)
      await dash.goto('/')
      await expect(dash.getByRole('button', { name: 'Open account menu' })).toBeVisible()
      await expect(dash.getByText("You don't have access")).toHaveCount(0)

      const state = await mintSession(mate.userId)
      const token = decodeURIComponent(state.cookies[0].value).split('.')[0]
      await supportDb()`UPDATE session SET scope = 'portal' WHERE token = ${token}`
      const context = await visitorContext(browser, { storageState: state })
      const portal = await context.newPage()
      await portal.goto('/')
      await expect(portal.getByText("You don't have access")).toBeVisible()
      await dash.context().close()
      await context.close()
    })
  }
)

test(
  'PPL-AUTH-66 changing portal access writes one audit row per changed field',
  { tag: ['@core', '@isolated'] },
  async ({ playwright, newTeammate }) => {
    await withAuthSettings({ portal_config: { 'access.visibility': 'public' } }, async () => {
      const admin = await personApi(playwright, 'admin')
      const since = new Date()
      const input = {
        visibility: 'private',
        allowedDomains: ['@Acme-E2E.test', 'bad', 'https://x.com', 'a@b.com', 'acme-e2e.test'],
        widgetSignIn: true,
      }
      const res = await callServerFn(admin, 'updatePortalAccessFn', input)
      expect(res.ok, res.error).toBe(true)
      const [row] = await supportDb()`SELECT portal_config FROM settings LIMIT 1`
      const access = JSON.parse(String(row.portal_config)).access
      expect(access).toMatchObject({
        visibility: 'private',
        allowedDomains: ['acme-e2e.test'],
        widgetSignIn: true,
      })
      for (const event of [
        'portal.visibility.changed',
        'portal.allowed_domains.changed',
        'portal.widget_signin.changed',
      ]) {
        expect(await audits(event, { since }), event).toHaveLength(1)
      }
      const [vis] = await audits('portal.visibility.changed', { since })
      expect(vis.after_value).toMatchObject({ visibility: 'private' })

      // The same input again changes nothing and writes nothing.
      const again = new Date()
      expect((await callServerFn(admin, 'updatePortalAccessFn', input)).ok).toBe(true)
      await admin.dispose()
      for (const event of ['portal.visibility.changed', 'portal.allowed_domains.changed']) {
        expect(await audits(event, { since: again }), event).toHaveLength(0)
      }

      const manager = await newTeammate({ roleKey: 'support_lead' })
      const api = await manager.api(playwright)
      const denied = await callServerFn(api, 'updatePortalAccessFn', { visibility: 'public' })
      await api.dispose()
      expect(denied.ok).toBe(false)
      expect(denied.error).toContain("Requires permission 'settings.manage'")
    })
  }
)
