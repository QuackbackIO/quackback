/**
 * How people come to be (and stop being) changelog subscribers: the portal
 * Subscribe button, auto-subscribe on sign-up and widget identify, the email
 * unsubscribe link, the People profile toggle and the CSV import.
 *
 * Journeys: CHG-S-01, CHG-S-03, CHG-S-04 (@isolated: the widget is off in the
 * product suite), CHG-S-07 (@isolated), CHG-S-23,
 * CHG-S-24, CHG-S-25.
 */
import { writeFileSync } from 'node:fs'
import type { APIRequestContext } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { ISOLATED, ISOLATED_SKIP } from '../../support/automation'
import { supportDb } from '../../support/db'
import { supportEnv } from '../../support/env'
import { withSettings } from '../../support/isolated-settings'
import { linksIn, waitForMail } from '../../support/mailpit'
import { personApi } from '../../support/server-fns'
import {
  mintCustomer,
  portalPage,
  resetIdentifyBudget,
  signSsoToken,
  widgetSecret,
} from '../../support/widget-portal'
import { waitForHydration } from '../../utils/helpers'
import {
  changelogSubscriber,
  createEntry,
  retireChangelog,
  subscriptionOf,
  trackSubscriber,
  waitForAnnouncementHandled,
  announcementsTo,
} from '../../product/changelog'

test.afterEach(async () => {
  await retireChangelog()
})

async function principalUuidOf(email: string): Promise<string | null> {
  const [row] = await supportDb()`SELECT p.id FROM principal p JOIN "user" u ON u.id = p.user_id
    WHERE lower(u.email) = lower(${email})`
  return row ? String(row.id) : null
}

/** Sign up through Better Auth's email-and-password endpoint. */
async function signUp(request: APIRequestContext, email: string) {
  const res = await request.post('/api/auth/sign-up/email', {
    headers: { origin: supportEnv().baseUrl },
    data: { email, password: 'correct-horse-battery-9', name: 'New Person' },
  })
  expect(res.status(), await res.text()).toBeLessThan(300)
}

test(
  'CHG-S-01 the Subscribe button toggles a signed-in customer’s subscription and remembers it',
  { tag: '@core' },
  async ({ browser, page, marker }) => {
    // Anonymous visitors get no button.
    await page.goto('/changelog')
    await expect(page.getByRole('link', { name: /RSS Feed/ })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Subscribe/ })).toHaveCount(0)

    const customer = await mintCustomer({ email: `${marker}@customers.example` })
    trackSubscriber(customer.principalUuid)
    const portal = await portalPage(browser, customer)
    await portal.goto('/changelog')
    const subscribe = portal.getByRole('button', { name: 'Subscribe', exact: true })
    await waitForHydration(subscribe)
    await subscribe.click()
    await expect(portal.getByRole('button', { name: 'Subscribed', exact: true })).toBeVisible()
    await expect
      .poll(async () => (await subscriptionOf(customer.principalUuid))?.source)
      .toBe('self_serve')
    expect((await subscriptionOf(customer.principalUuid))?.unsubscribed_at).toBeNull()

    await portal.reload()
    const subscribed = portal.getByRole('button', { name: 'Subscribed', exact: true })
    await waitForHydration(subscribed)
    await subscribed.click()
    await expect(portal.getByRole('button', { name: 'Subscribe', exact: true })).toBeVisible()
    await expect
      .poll(async () => (await subscriptionOf(customer.principalUuid))?.unsubscribed_at)
      .not.toBeNull()
    await portal.context().close()
  }
)

test(
  'CHG-S-03 a new portal account is subscribed when it is created, and gets the next entry',
  { tag: '@core' },
  async ({ playwright, request, marker }) => {
    const email = `${marker}@customers.example`
    await signUp(request, email)
    const uuid = await principalUuidOf(email)
    expect(uuid).not.toBeNull()
    trackSubscriber(uuid!)
    await expect.poll(async () => (await subscriptionOf(uuid!))?.source).toBe('auto')
    expect((await subscriptionOf(uuid!))?.unsubscribed_at).toBeNull()

    const admin = await personApi(playwright, 'admin')
    const entry = await createEntry(admin, { title: `${marker} welcome`, state: 'published' })
    await waitForMail({ to: email, subject: entry.title })
    await admin.dispose()
  }
)

test(
  'CHG-S-04 a verified widget identify subscribes a new person once; an opt-out survives later identifies',
  { tag: ['@core', '@isolated'] },
  async ({ request, marker }) => {
    test.skip(!ISOLATED, ISOLATED_SKIP)
    await withSettings({ widget_config: { enabled: true } }, async () => {
      await resetIdentifyBudget()
      const secret = await widgetSecret(request)
      const email = `${marker}@customers.example`
      const identify = async () => {
        const res = await request.post('/api/widget/identify', {
          data: { ssoToken: signSsoToken({ id: marker, email, name: 'Widget Person' }, secret) },
        })
        expect(res.status(), await res.text()).toBe(200)
      }
      await identify()
      const uuid = await principalUuidOf(email)
      expect(uuid).not.toBeNull()
      trackSubscriber(uuid!)
      await expect.poll(async () => (await subscriptionOf(uuid!))?.source).toBe('auto')

      await identify()
      const [{ n }] =
        await supportDb()`SELECT count(*)::int AS n FROM changelog_subscriptions WHERE principal_id = ${uuid}`
      expect(n).toBe(1)

      await supportDb()`UPDATE changelog_subscriptions SET unsubscribed_at = now() WHERE principal_id = ${uuid}`
      await identify()
      expect((await subscriptionOf(uuid!))?.unsubscribed_at).not.toBeNull()
    })
  }
)

test(
  'CHG-S-07 with auto-subscribe off new accounts are not subscribed, and turning it on is not retroactive',
  { tag: ['@core', '@isolated'] },
  async ({ request, marker }) => {
    test.skip(!ISOLATED, ISOLATED_SKIP)
    const off = `${marker}-off@customers.example`
    await withSettings({ metadata: { 'changelogSettings.autoSubscribe': false } }, async () => {
      await signUp(request, off)
    })
    const offUuid = await principalUuidOf(off)
    expect(offUuid).not.toBeNull()
    // Back on: the earlier account stays unsubscribed; a new one is subscribed.
    const on = `${marker}-on@customers.example`
    await withSettings({ metadata: { 'changelogSettings.autoSubscribe': true } }, async () => {
      await signUp(request, on)
    })
    const onUuid = (await principalUuidOf(on))!
    trackSubscriber(onUuid)
    await expect.poll(async () => (await subscriptionOf(onUuid))?.source).toBe('auto')
    expect(await subscriptionOf(offUuid!)).toBeNull()
  }
)

test(
  'CHG-S-23 the email unsubscribe link: a confirm page, then only changelog email stops',
  { tag: '@core' },
  async ({ page, playwright, marker }) => {
    const admin = await personApi(playwright, 'admin')
    const sub = await changelogSubscriber(marker)
    const first = await createEntry(admin, { title: `${marker} first`, state: 'published' })
    const mail = await waitForMail({ to: sub.email, subject: first.title })
    const link = linksIn(mail).find((l) => /\/unsubscribe\?token=/.test(l))!
    expect(link).toBeDefined()

    // Opening the link changes nothing until the button is pressed.
    await page.goto(link)
    expect((await subscriptionOf(sub.principalUuid))?.unsubscribed_at).toBeNull()
    const confirm = page.getByRole('button').filter({ hasText: /unsubscribe/i })
    await waitForHydration(confirm)
    await confirm.click()
    await expect(page.getByText('Done')).toBeVisible()
    await expect
      .poll(async () => (await subscriptionOf(sub.principalUuid))?.unsubscribed_at)
      .not.toBeNull()

    // A one-click POST to the same URL answers 200 (already spent or not).
    const oneClick = await page.request.post(link, {
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      data: 'List-Unsubscribe=One-Click',
    })
    expect(oneClick.status()).toBe(200)

    const control = await changelogSubscriber(marker, 'control')
    const second = await createEntry(admin, { title: `${marker} second`, state: 'published' })
    await waitForMail({ to: control.email, subject: second.title })
    await waitForAnnouncementHandled(second.id)
    expect(await announcementsTo(sub.email, second.title)).toHaveLength(0)
    await admin.dispose()
  }
)

test(
  'CHG-S-24 the People profile switch subscribes and unsubscribes a person',
  { tag: '@core' },
  async ({ asPerson, marker }) => {
    const customer = await mintCustomer({ email: `${marker}@customers.example` })
    trackSubscriber(customer.principalUuid)
    const admin = await asPerson('admin')
    await admin.goto(`/admin/users?selected=${customer.principalId}`)
    const toggle = admin.getByRole('switch', { name: 'Changelog emails' })
    await waitForHydration(toggle)
    await expect(toggle).not.toBeChecked()
    await toggle.click()
    await expect(toggle).toBeChecked()
    await expect
      .poll(async () => (await subscriptionOf(customer.principalUuid))?.source)
      .toBe('admin')
    expect((await subscriptionOf(customer.principalUuid))?.unsubscribed_at).toBeNull()
    await toggle.click()
    await expect(toggle).not.toBeChecked()
    await expect
      .poll(async () => (await subscriptionOf(customer.principalUuid))?.unsubscribed_at)
      .not.toBeNull()
  }
)

test(
  'CHG-S-25 CSV import: an Email column, the consent gate, and a summary of who was subscribed',
  { tag: '@core' },
  async ({ asPerson, marker }, testInfo) => {
    const known = await mintCustomer({ email: `${marker}-known@customers.example` })
    const other = await mintCustomer({ email: `${marker}-other@customers.example` })
    trackSubscriber(known.principalUuid)
    trackSubscriber(other.principalUuid)
    const csv = testInfo.outputPath('subscribers.csv')
    writeFileSync(
      csv,
      [
        'Name,Email',
        `Known,${known.email}`,
        `Shout,${other.email.toUpperCase()}`,
        `Again,${known.email}`,
        `Nobody,${marker}-nobody@customers.example`,
      ].join('\n')
    )

    const admin = await asPerson('admin')
    await admin.goto('/admin/settings/changelog')
    const input = admin.locator('input[type="file"][accept=".csv,text/csv"]')
    await waitForHydration(admin.getByText('Click to choose a CSV file'))
    await input.setInputFiles(csv)
    // The file has four addresses; the server lowercases and de-duplicates them.
    const submit = admin.getByRole('button', { name: 'Subscribe 4 emails' })
    await expect(submit).toBeDisabled()
    await admin
      .getByText('I confirm every person on this list has agreed to receive email from us', {
        exact: false,
      })
      .click()
    await expect(submit).toBeEnabled()
    await submit.click()
    await expect(admin.getByText('Import complete')).toBeVisible()
    await expect(
      admin.getByText('2 of 3 emails subscribed. 1 had no matching account.')
    ).toBeVisible()
    expect((await subscriptionOf(known.principalUuid))?.source).toBe('csv_import')
    expect((await subscriptionOf(other.principalUuid))?.source).toBe('csv_import')
  }
)
