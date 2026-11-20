/**
 * Self-serve status subscriptions from the public page.
 *
 * Journeys: STA-S-01, STA-S-02, STA-S-03, STA-S-04, STA-S-05, STA-S-06,
 * STA-S-07, STA-S-09.
 *
 * One subscription row per person: every test mints its own portal users and
 * unsubscribes them at the end (a page-wide subscriber gets every other
 * test's publish email).
 */
import type { APIRequestContext } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { callServerFn, personApi } from '../../support/server-fns'
import { pollFor } from '../../support/db'
import { supportEnv } from '../../support/env'
import { portalPage } from '../../support/widget-portal'
import {
  createService,
  deleteMadeIncidents,
  messageOf,
  mintPortalUser,
  must,
  subscribeAs,
  subscriptionRow,
  unsubscribeAs,
  type PortalUser,
} from '../../product/status'

test.describe.configure({ timeout: 60_000 })

let admin: APIRequestContext
let users: PortalUser[] = []

test.beforeEach(async ({ playwright }) => {
  admin = await personApi(playwright, 'admin')
  users = []
})
test.afterEach(async () => {
  for (const u of users) {
    await unsubscribeAs(u)
    await u.api.dispose()
  }
  await deleteMadeIncidents(admin)
  await admin.dispose()
})

async function user(
  playwright: Parameters<typeof mintPortalUser>[0],
  marker: string,
  label = 'sub'
) {
  const u = await mintPortalUser(playwright, marker, label)
  users.push(u)
  return u
}

test(
  'STA-S-01 a signed-in user subscribes to all updates',
  { tag: '@core' },
  async ({ browser, playwright, marker }) => {
    const u = await user(playwright, marker)
    const page = await portalPage(browser, u)
    await page.goto('/status')
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Subscribe', exact: true }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Subscribe to updates' })
    await expect(
      dialog.getByText("We'll email you when incidents and maintenance are posted.")
    ).toBeVisible()
    await expect(dialog.getByRole('radio', { name: /All updates/ })).toBeChecked()
    await dialog.getByRole('button', { name: 'Subscribe', exact: true }).click()
    await expect(page.getByText('Subscribed to status updates')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Subscribed' })).toBeVisible()
    expect(await subscriptionRow(u.principalUuid)).toMatchObject({
      scope: 'page',
      component_ids: [],
      source: 'self_serve',
      unsubscribed_at: null,
    })
    const mine = await must<{ subscribed: boolean }>(
      u.api,
      'getMyStatusSubscriptionFn',
      undefined,
      { method: 'GET' }
    )
    expect(mine.subscribed).toBe(true)
    await page.context().close()
  }
)

test(
  'STA-S-02 subscribe to specific services',
  { tag: '@core' },
  async ({ browser, playwright, marker }) => {
    const a = await createService(admin, `${marker} Pick A`)
    const b = await createService(admin, `${marker} Pick B`)
    const u = await user(playwright, marker)
    const page = await portalPage(browser, u)
    await page.goto('/status')
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Subscribe', exact: true }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Subscribe to updates' })
    await dialog.getByRole('radio', { name: /Specific services/ }).click()
    const submit = dialog.getByRole('button', { name: 'Subscribe', exact: true })
    await expect(submit).toBeDisabled()
    await dialog.getByRole('checkbox', { name: a.name }).check()
    await dialog.getByRole('checkbox', { name: b.name }).check()
    await submit.click()
    await expect(page.getByText('Subscribed to status updates')).toBeVisible()
    const row = await subscriptionRow(u.principalUuid)
    expect(row?.scope).toBe('components')
    expect([...(row?.component_ids ?? [])].sort()).toEqual([a.id, b.id].sort())
    await page.context().close()
  }
)

test(
  'STA-S-03 STA-S-04 an anonymous visitor is sent through sign-in and subscribed on return',
  { tag: '@core' },
  async ({ browser, page, playwright, marker }) => {
    await page.goto('/status')
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Subscribe', exact: true }).first().click()
    const dialog = page.getByRole('dialog', { name: 'Subscribe to updates' })
    await expect(
      dialog.getByText(/Email updates need a free portal account\. Or follow the/)
    ).toBeVisible()
    await expect(dialog.getByRole('link', { name: 'RSS feed' })).toHaveAttribute(
      'href',
      /\/status\/feed$/
    )
    await dialog.getByRole('button', { name: 'Subscribe', exact: true }).click()
    await expect(page.getByText('Sign in to get status updates by email.')).toBeVisible()
    const saved = await page.evaluate(() =>
      localStorage.getItem('quackback:pending-status-subscription')
    )
    expect(JSON.parse(saved ?? '{}')).toMatchObject({ scope: 'page' })

    // A sign-in that left the page comes back to ?subscribe=resume: the saved
    // choice completes and the marker leaves the URL.
    const u = await user(playwright, marker)
    const signedIn = await portalPage(browser, u)
    await signedIn.goto('/status')
    await signedIn.evaluate(
      (value) => localStorage.setItem('quackback:pending-status-subscription', value),
      JSON.stringify({ scope: 'page', componentIds: [], savedAt: Date.now() })
    )
    await signedIn.bringToFront()
    await signedIn.goto('/status?subscribe=resume')
    // The session is read on the client first, so the resume can take a while.
    await expect(signedIn.getByText('Subscribed to status updates')).toBeVisible({
      timeout: 20_000,
    })
    await expect(signedIn).not.toHaveURL(/subscribe=resume/)
    await pollFor('the subscription', async () =>
      (await subscriptionRow(u.principalUuid))?.unsubscribed_at === null ? true : null
    )

    // A choice older than 30 minutes is dropped.
    const late = await user(playwright, marker, 'late')
    const latePage = await portalPage(browser, late)
    await latePage.goto('/status')
    await latePage.evaluate(
      (value) => localStorage.setItem('quackback:pending-status-subscription', value),
      JSON.stringify({ scope: 'page', componentIds: [], savedAt: Date.now() - 31 * 60_000 })
    )
    await latePage.bringToFront()
    await latePage.goto('/status?subscribe=resume')
    await expect(
      latePage.getByRole('button', { name: 'Subscribe', exact: true }).first()
    ).toBeVisible()
    await latePage.waitForLoadState('networkidle')
    expect(await subscriptionRow(late.principalUuid)).toBeNull()
    await signedIn.context().close()
    await latePage.context().close()
  }
)

test(
  'STA-S-05 anonymous sessions cannot subscribe',
  { tag: '@core' },
  async ({ playwright, marker }) => {
    const anonUser = await mintPortalUser(playwright, marker, 'anon', { anonymous: true })
    const anonApi = anonUser.api
    const nobody = await playwright.request.newContext({ baseURL: supportEnv().baseUrl })
    try {
      const anon = await callServerFn(anonApi, 'subscribeStatusFn', { scope: 'page' })
      expect(anon.ok).toBe(false)
      expect(anon.code).toBe('ANONYMOUS_NOT_ALLOWED')
      expect(messageOf(anon)).toBe('Anonymous interaction is not enabled')
      const none = await callServerFn(nobody, 'subscribeStatusFn', { scope: 'page' })
      expect(none.ok).toBe(false)
      // The portal button opens sign-in on this message (not masked in production).
      expect(messageOf(none)).toBe('Authentication required')
      expect(await subscriptionRow(anonUser.principalUuid)).toBeNull()
    } finally {
      await anonApi.dispose()
      await nobody.dispose()
    }
  }
)

test(
  'STA-S-06 unsubscribe from the page',
  { tag: '@core' },
  async ({ browser, playwright, marker }) => {
    const u = await user(playwright, marker)
    await subscribeAs(u)
    const page = await portalPage(browser, u)
    await page.goto('/status')
    await page.waitForLoadState('networkidle')
    await page.getByRole('button', { name: 'Subscribed' }).click()
    const confirm = page.getByRole('alertdialog').or(page.getByRole('dialog'))
    await expect(confirm.getByText('Unsubscribe from status updates?')).toBeVisible()
    await expect(
      confirm.getByText("You'll stop getting emails about incidents and maintenance.")
    ).toBeVisible()
    await expect(confirm.getByRole('button', { name: 'Stay subscribed' })).toBeVisible()
    await confirm.getByRole('button', { name: 'Unsubscribe', exact: true }).click()
    await expect(page.getByText('Unsubscribed from status updates')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Subscribe', exact: true }).first()).toBeVisible()
    const row = await subscriptionRow(u.principalUuid)
    expect(row).not.toBeNull()
    expect(row?.unsubscribed_at).not.toBeNull()
    await page.context().close()
  }
)

test(
  'STA-S-07 re-subscribe after opting out',
  { tag: '@nightly' },
  async ({ playwright, marker }) => {
    const svc = await createService(admin, `${marker} Resub`)
    const u = await user(playwright, marker)
    await must(admin, 'addStatusSubscriberFn', { email: u.email })
    await must(admin, 'removeStatusSubscriberFn', { principalId: u.principalId })
    await subscribeAs(u, 'components', [svc.id])
    const row = await subscriptionRow(u.principalUuid)
    expect(row).toMatchObject({
      scope: 'components',
      component_ids: [svc.id],
      unsubscribed_at: null,
    })
  }
)

test(
  'STA-S-09 a component subscription with no or unknown services is refused',
  { tag: '@nightly' },
  async ({ playwright, marker }) => {
    const empty = await user(playwright, marker, 'empty')
    const res = await callServerFn(empty.api, 'subscribeStatusFn', {
      scope: 'components',
      componentIds: [],
    })
    expect(res.ok).toBe(false)
    const bogus = await user(playwright, marker, 'bogus')
    const res2 = await callServerFn(bogus.api, 'subscribeStatusFn', {
      scope: 'components',
      componentIds: ['status_component_01m7v6aewge02vtv3kd36ggmcw'],
    })
    expect(res2.ok).toBe(false)
    expect(await subscriptionRow(empty.principalUuid)).toBeNull()
  }
)
