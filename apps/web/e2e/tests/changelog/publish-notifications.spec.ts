/**
 * Who hears about a published changelog entry, and how: subscriber email,
 * in-app bells, the outgoing webhook, and the once-only announcement claim.
 *
 * Journeys: CHG-S-08, CHG-S-09, CHG-S-10, CHG-S-11, CHG-S-12, CHG-S-13,
 * CHG-S-14, CHG-S-15, CHG-S-16, CHG-S-17 (@isolated), CHG-S-18,
 * CHG-S-19, CHG-S-21, CHG-S-27, CHG-S-28, CHG-A-15.
 *
 * Every publish mails every active subscriber in the workspace, so each test
 * reads only its own subscribers' mail, matched by the entry's title, and
 * proves an absence only after the entry's event was fully handled.
 */
import { randomUUID } from 'node:crypto'
import { toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { ISOLATED, ISOLATED_SKIP } from '../../support/automation'
import { bellsFor, waitForBells } from '../../support/bells'
import { supportDb } from '../../support/db'
import { withSettings } from '../../support/isolated-settings'
import {
  emailLogFor,
  getMailHeaders,
  linksIn,
  waitForEmailLog,
  waitForMail,
} from '../../support/mailpit'
import { personApi } from '../../support/server-fns'
import { runSweep } from '../../support/sweeps'
import { mintCustomer, portalPage } from '../../support/widget-portal'
import {
  bodyOf,
  deliveriesOf,
  expectSigned,
  hooksApi,
  subscribe as hook,
  unsubscribe,
} from '../../support/webhooks'
import { sink } from '../../support/webhook-sink-client'
import {
  adminRest,
  announcementEvents,
  announcementsTo,
  changelogSubscriber,
  createEntry,
  createLabel,
  waitForEntry,
  makeJobDue,
  segmentWith,
  shippedPost,
  retireChangelog,
  trackSubscriber,
  updateEntry,
  waitForAnnouncementHandled,
} from '../../product/changelog'

test.afterEach(async () => {
  await retireChangelog()
})

async function follow(postId: string, principalUuid: string): Promise<void> {
  await supportDb()`INSERT INTO post_subscriptions (id, post_id, principal_id, reason)
    VALUES (gen_random_uuid(), ${toUuid(postId as `post_${string}`)}, ${principalUuid}, 'vote')`
}

test(
  'CHG-S-19 one entry is announced exactly once across publish, unpublish, republish and edits',
  { tag: '@smoke' },
  async ({ playwright, people, marker, baseURL }) => {
    const admin = await personApi(playwright, 'admin')
    const sub = await changelogSubscriber(marker)
    const hooks = await hooksApi(playwright, baseURL, people, marker)
    const wh = await hook(hooks, marker, ['changelog.published'])
    try {
      const entry = await createEntry(admin, { title: `${marker} once only`, state: 'published' })
      await waitForMail({ to: sub.email, subject: entry.title })
      await waitForAnnouncementHandled(entry.id)

      expect((await updateEntry(admin, entry.id, { publishState: { type: 'draft' } })).ok).toBe(
        true
      )
      expect((await updateEntry(admin, entry.id, { publishState: { type: 'published' } })).ok).toBe(
        true
      )
      expect(
        (await updateEntry(admin, entry.id, { content: `${entry.title} edited body.` })).ok
      ).toBe(true)

      expect(await announcementEvents(entry.id)).toBe(1)
      await waitForAnnouncementHandled(entry.id)
      expect(await announcementsTo(sub.email, entry.title)).toHaveLength(1)
      const bells = await bellsFor(sub.principalId, entry.id)
      expect(bells.map((b) => b.type)).toEqual(['changelog_published'])
      const deliveries = await sink.deliveries(marker)
      expect(deliveries.filter((d) => d.body.includes(entry.id))).toHaveLength(1)
    } finally {
      await unsubscribe(hooks, wh)
      await hooks.dispose()
      await admin.dispose()
    }
  }
)

test(
  'CHG-S-08 active subscribers get one email and one bell; opted-out and unsubscribed people get none',
  { tag: '@core' },
  async ({ playwright, marker }) => {
    const admin = await personApi(playwright, 'admin')
    const active = await changelogSubscriber(marker, 'active')
    const optedOut = await changelogSubscriber(marker, 'optout')
    await supportDb()`UPDATE changelog_subscriptions SET unsubscribed_at = now() WHERE principal_id = ${optedOut.principalUuid}`
    const stranger = await mintCustomer({ email: `${marker}-none@customers.example` })

    const entry = await createEntry(admin, {
      title: `${marker} for subscribers`,
      state: 'published',
    })
    await waitForMail({ to: active.email, subject: entry.title })
    await waitForAnnouncementHandled(entry.id)
    expect(await announcementsTo(active.email, entry.title)).toHaveLength(1)
    expect(await bellsFor(active.principalId, entry.id)).toHaveLength(1)
    for (const p of [optedOut, stranger]) {
      expect(await announcementsTo(p.email, entry.title), p.email).toHaveLength(0)
      expect(await bellsFor(p.principalId, entry.id)).toHaveLength(0)
    }
    await waitForEmailLog(active.email, { status: 'sent' })
    await admin.dispose()
  }
)

test(
  'CHG-S-09 followers of a linked post hear about the entry without a changelog subscription',
  { tag: '@core' },
  async ({ playwright, people, marker }) => {
    const admin = await personApi(playwright, 'admin')
    const rest = await adminRest(playwright, people)
    const postId = (await shippedPost(rest, marker)).id
    await rest.dispose()
    const follower = await mintCustomer({ email: `${marker}-voter@customers.example` })
    await follow(postId, follower.principalUuid)
    const control = await changelogSubscriber(marker, 'control')

    const entry = await createEntry(admin, {
      title: `${marker} with a shipped post`,
      state: 'published',
      linkedPostIds: [postId],
    })
    await waitForMail({ to: follower.email, subject: entry.title })
    await waitForMail({ to: control.email, subject: entry.title })
    await waitForAnnouncementHandled(entry.id)
    expect(await announcementsTo(follower.email, entry.title)).toHaveLength(1)
    expect(await bellsFor(follower.principalId, entry.id)).toHaveLength(1)
    await admin.dispose()
  }
)

test(
  'CHG-S-10 a changelog opt-out beats following a linked post',
  { tag: '@core' },
  async ({ playwright, people, marker }) => {
    const admin = await personApi(playwright, 'admin')
    const rest = await adminRest(playwright, people)
    const postId = (await shippedPost(rest, marker)).id
    await rest.dispose()
    const follower = await mintCustomer({ email: `${marker}-voter@customers.example` })
    await follow(postId, follower.principalUuid)
    // The person opted out (unsubscribeFromChangelogFn makes this row).
    await supportDb()`INSERT INTO changelog_subscriptions (id, principal_id, source, unsubscribed_at)
      VALUES (gen_random_uuid(), ${follower.principalUuid}, 'self_serve', now())`
    trackSubscriber(follower.principalUuid)
    const control = await changelogSubscriber(marker, 'control')

    const entry = await createEntry(admin, {
      title: `${marker} opt-out wins`,
      state: 'published',
      linkedPostIds: [postId],
    })
    await waitForMail({ to: control.email, subject: entry.title })
    await waitForAnnouncementHandled(entry.id)
    expect(await announcementsTo(follower.email, entry.title)).toHaveLength(0)
    expect(await bellsFor(follower.principalId, entry.id)).toHaveLength(0)
    await admin.dispose()
  }
)

test(
  'CHG-S-11 the publisher is not notified of their own announcement',
  { tag: '@nightly' },
  async ({ playwright, people, marker }) => {
    const admin = await personApi(playwright, 'admin')
    const adminUuid = toUuid(people.people.admin.principalId as `principal_${string}`)
    const [before] =
      await supportDb()`SELECT unsubscribed_at FROM changelog_subscriptions WHERE principal_id = ${adminUuid}`
    await supportDb()`INSERT INTO changelog_subscriptions (id, principal_id, source)
      VALUES (gen_random_uuid(), ${adminUuid}, 'admin') ON CONFLICT (principal_id) DO UPDATE SET unsubscribed_at = NULL`
    try {
      const control = await changelogSubscriber(marker, 'control')
      const entry = await createEntry(admin, {
        title: `${marker} not to myself`,
        state: 'published',
      })
      await waitForMail({ to: control.email, subject: entry.title })
      await waitForAnnouncementHandled(entry.id)
      expect(await announcementsTo(people.people.admin.email, entry.title)).toHaveLength(0)
      expect(await bellsFor(people.people.admin.principalId, entry.id)).toHaveLength(0)
    } finally {
      if (before) {
        await supportDb()`UPDATE changelog_subscriptions SET unsubscribed_at = ${before.unsubscribed_at} WHERE principal_id = ${adminUuid}`
      } else {
        await supportDb()`DELETE FROM changelog_subscriptions WHERE principal_id = ${adminUuid}`
      }
      await admin.dispose()
    }
  }
)

test(
  'CHG-S-12 a segment-targeted announcement reaches only members, by email and bell',
  { tag: '@core' },
  async ({ playwright, marker }) => {
    const admin = await personApi(playwright, 'admin')
    const member = await changelogSubscriber(marker, 'member')
    const outsider = await changelogSubscriber(marker, 'outsider')
    const segment = await segmentWith(marker, [member.principalUuid])
    const entry = await createEntry(admin, {
      title: `${marker} members only news`,
      state: 'published',
      segmentIds: [segment],
    })
    await waitForMail({ to: member.email, subject: entry.title })
    await waitForAnnouncementHandled(entry.id)
    expect(await bellsFor(member.principalId, entry.id)).toHaveLength(1)
    expect(await announcementsTo(outsider.email, entry.title)).toHaveLength(0)
    expect(await bellsFor(outsider.principalId, entry.id)).toHaveLength(0)
    await admin.dispose()
  }
)

test(
  'CHG-S-13 the announcement email: subject, heading, body, link and unsubscribe header',
  { tag: '@core' },
  async ({ playwright, marker }) => {
    const admin = await personApi(playwright, 'admin')
    const sub = await changelogSubscriber(marker)
    const [ws] = await supportDb()`SELECT name FROM settings LIMIT 1`
    const entry = await createEntry(admin, {
      title: `${marker} mail shape`,
      content: `${marker} the detailed body of this update.`,
      state: 'published',
    })
    const mail = await waitForMail({ to: sub.email, subject: entry.title })
    expect(mail.Subject).toBe(`New update: ${entry.title}`)
    expect(mail.HTML).toContain('New update published')
    const html = mail.HTML.replaceAll('<!-- -->', '')
    expect(html).toContain(`${String(ws.name)} just published a product update.`)
    expect(mail.HTML).toContain(`${marker} the detailed body of this update.`)
    const headers = await getMailHeaders(mail.ID)
    const unsub = headers['List-Unsubscribe']?.[0] ?? ''
    expect(unsub).toMatch(/^<https?:\/\/[^>]+\/unsubscribe\?token=[^>]+>$/)
    // The e2e origin is http, so no one-click header.
    expect(headers['List-Unsubscribe-Post']).toBeUndefined()
    expect(linksIn(mail).some((l) => /\/unsubscribe\?token=/.test(l))).toBe(true)
    // The subscriber also gets other tests' announcements: find this one's row.
    await expect
      .poll(async () =>
        (await emailLogFor(sub.email)).some(
          (r) => r.subject === `New update: ${entry.title}` && r.status === 'sent'
        )
      )
      .toBe(true)
    await admin.dispose()
  }
)

test(
  'CHG-S-14 the email "View Update" button links to the entry itself',
  { tag: '@nightly' },
  async ({ playwright, marker }) => {
    const admin = await personApi(playwright, 'admin')
    const sub = await changelogSubscriber(marker)
    const entry = await createEntry(admin, { title: `${marker} view link`, state: 'published' })
    const mail = await waitForMail({ to: sub.email, subject: entry.title })
    const view = linksIn(mail).filter((l) => /\/changelog/.test(l))
    expect(view.length).toBeGreaterThan(0)
    expect(view.every((l) => l.includes(`/changelog/${entry.id}`))).toBe(true)
    await admin.dispose()
  }
)

test(
  'CHG-S-15 the in-app bell: title, body and a link to the entry',
  { tag: '@core' },
  async ({ playwright, browser, marker }) => {
    const admin = await personApi(playwright, 'admin')
    const sub = await changelogSubscriber(marker)
    const entry = await createEntry(admin, {
      title: `${marker} bell`,
      content: `${marker} bell body words.`,
      state: 'published',
    })
    const [bell] = await waitForBells(sub.principalId, entry.id, (rows) => rows.length === 1)
    expect(bell).toMatchObject({ type: 'changelog_published', title: `New update: ${entry.title}` })
    expect(bell.body).toContain(`${marker} bell body words.`)

    const page = await portalPage(browser, sub)
    await page.goto('/notifications')
    const item = page.getByText(`New update: ${entry.title}`)
    await expect(item).toBeVisible()
    await item.click()
    await expect(page).toHaveURL(new RegExp(`/changelog/${entry.id}$`))
    await expect(page.getByRole('heading', { name: entry.title })).toBeVisible()
    await page.context().close()
    await admin.dispose()
  }
)

test(
  'CHG-S-16 preferences: email off keeps the bell, in-app off keeps the email, all email muted',
  { tag: '@core' },
  async ({ playwright, marker }) => {
    const admin = await personApi(playwright, 'admin')
    const noEmail = await changelogSubscriber(marker, 'noemail')
    const noBell = await changelogSubscriber(marker, 'nobell')
    const muted = await changelogSubscriber(marker, 'muted')
    const control = await changelogSubscriber(marker, 'control')
    const prefs = async (p: { principalUuid: string }, matrix: object | null, emailMuted = false) =>
      supportDb()`INSERT INTO notification_preferences (id, principal_id, email_muted, matrix)
        VALUES (gen_random_uuid(), ${p.principalUuid}, ${emailMuted}, ${matrix ? supportDb().json(matrix as never) : null})`
    await prefs(noEmail, { changelog_published: { email: false } })
    await prefs(noBell, { changelog_published: { inApp: false } })
    await prefs(muted, null, true)

    const entry = await createEntry(admin, { title: `${marker} prefs`, state: 'published' })
    await waitForMail({ to: control.email, subject: entry.title })
    await waitForAnnouncementHandled(entry.id)
    expect(await announcementsTo(noEmail.email, entry.title)).toHaveLength(0)
    expect(await bellsFor(noEmail.principalId, entry.id)).toHaveLength(1)
    expect(await announcementsTo(noBell.email, entry.title)).toHaveLength(1)
    expect(await bellsFor(noBell.principalId, entry.id)).toHaveLength(0)
    expect(await announcementsTo(muted.email, entry.title)).toHaveLength(0)
    expect(await bellsFor(muted.principalId, entry.id)).toHaveLength(1)
    await admin.dispose()
  }
)

test(
  'CHG-S-17 with changelog emails turned off, subscribers get the bell and no email',
  { tag: ['@core', '@isolated'] },
  async ({ playwright, marker }) => {
    test.skip(!ISOLATED, ISOLATED_SKIP)
    const admin = await personApi(playwright, 'admin')
    const sub = await changelogSubscriber(marker)
    await withSettings({ metadata: { 'changelogSettings.emailsDisabled': true } }, async () => {
      const entry = await createEntry(admin, { title: `${marker} kill switch`, state: 'published' })
      await waitForBells(sub.principalId, entry.id, (rows) => rows.length === 1)
      await waitForAnnouncementHandled(entry.id)
      expect(await announcementsTo(sub.email, entry.title)).toHaveLength(0)
    })
    // Control: back on, the next entry is mailed.
    const next = await createEntry(admin, { title: `${marker} switch back`, state: 'published' })
    await waitForMail({ to: sub.email, subject: next.title })
    await admin.dispose()
  }
)

test(
  'CHG-S-18 "Send email" unchecked silences the whole announcement, for good',
  { tag: '@core' },
  async ({ playwright, people, marker, baseURL }) => {
    const admin = await personApi(playwright, 'admin')
    const sub = await changelogSubscriber(marker)
    const hooks = await hooksApi(playwright, baseURL, people, marker)
    const wh = await hook(hooks, marker, ['changelog.published'])
    try {
      const quiet = await createEntry(admin, {
        title: `${marker} quiet`,
        state: 'published',
        notify: false,
      })
      // Claimed (marked announced) without dispatching anything.
      await waitForEntry(quiet.id, 'claimed', (row) => row.notified_at !== null)
      // Republishing later never announces it either.
      await updateEntry(admin, quiet.id, { publishState: { type: 'draft' } })
      await updateEntry(admin, quiet.id, { publishState: { type: 'published' }, notify: true })
      // Control: an ordinary entry after it is announced on every channel.
      const loud = await createEntry(admin, { title: `${marker} loud`, state: 'published' })
      await waitForMail({ to: sub.email, subject: loud.title })
      await deliveriesOf(marker, 'changelog.published', loud.id)
      await waitForAnnouncementHandled(loud.id)

      expect(await announcementEvents(quiet.id)).toBe(0)
      expect(await announcementsTo(sub.email, quiet.title)).toHaveLength(0)
      expect(await bellsFor(sub.principalId, quiet.id)).toHaveLength(0)
      expect((await sink.deliveries(marker)).filter((d) => d.body.includes(quiet.id))).toHaveLength(
        0
      )
    } finally {
      await unsubscribe(hooks, wh)
      await hooks.dispose()
      await admin.dispose()
    }
  }
)

test(
  'CHG-S-21 the changelog.published webhook: signed, with the entry in its payload',
  { tag: '@core' },
  async ({ playwright, people, marker, baseURL }) => {
    const admin = await personApi(playwright, 'admin')
    const hooks = await hooksApi(playwright, baseURL, people, marker)
    const wh = await hook(hooks, marker, ['changelog.published'])
    try {
      const entry = await createEntry(admin, {
        title: `${marker} webhook`,
        content: `${marker} webhook body.`,
        state: 'published',
      })
      const [d] = await deliveriesOf(marker, 'changelog.published', entry.id)
      expectSigned(d, wh.secret)
      expect(d.headers['x-quackback-event']).toBe('changelog.published')
      const body = bodyOf<{ changelog: Record<string, unknown> }>(d)
      expect(body.type).toBe('changelog.published')
      expect(body.data.changelog).toMatchObject({
        id: entry.id,
        title: entry.title,
        linkedPostCount: 0,
      })
      expect(String(body.data.changelog.contentPreview)).toContain(`${marker} webhook body.`)
      expect(new Date(String(body.data.changelog.publishedAt)).toISOString()).toBe(
        new Date(String(entry.publishedAt)).toISOString()
      )
    } finally {
      await unsubscribe(hooks, wh)
      await hooks.dispose()
      await admin.dispose()
    }
  }
)

test(
  'CHG-S-27 an anonymous (placeholder) principal with a subscription gets no email',
  { tag: '@nightly' },
  async ({ playwright, marker }) => {
    const admin = await personApi(playwright, 'admin')
    // An anonymous visitor's account carries the synthetic placeholder address.
    const anon = await mintCustomer({
      email: `temp-${randomUUID()}@anon.quackback.io`,
      name: 'Visitor',
    })
    await supportDb()`UPDATE principal SET type = 'anonymous' WHERE id = ${anon.principalUuid}`
    await supportDb()`INSERT INTO changelog_subscriptions (id, principal_id, source)
      VALUES (gen_random_uuid(), ${anon.principalUuid}, 'auto')`
    trackSubscriber(anon.principalUuid)
    const control = await changelogSubscriber(marker, 'control')
    const entry = await createEntry(admin, {
      title: `${marker} no placeholder`,
      state: 'published',
    })
    await waitForMail({ to: control.email, subject: entry.title })
    await waitForAnnouncementHandled(entry.id)
    expect(await announcementsTo(anon.email, entry.title)).toHaveLength(0)
    const logs =
      await supportDb()`SELECT 1 FROM email_log WHERE lower(address) = lower(${anon.email})`
    expect(logs).toHaveLength(0)
    await admin.dispose()
  }
)

test(
  'CHG-S-28 an entry with a segment-gated label is not announced to subscribers outside the segment',
  { tag: '@core' },
  async ({ playwright, marker }) => {
    const admin = await personApi(playwright, 'admin')
    const member = await changelogSubscriber(marker, 'member')
    const outsider = await changelogSubscriber(marker, 'outsider')
    const segment = await segmentWith(marker, [member.principalUuid])
    const label = await createLabel(admin, `${marker.slice(-30)} vip`, [segment])
    const entry = await createEntry(admin, {
      title: `${marker} gated news`,
      state: 'published',
      categoryIds: [label.id],
    })
    await waitForMail({ to: member.email, subject: entry.title })
    await waitForAnnouncementHandled(entry.id)
    expect(await announcementsTo(outsider.email, entry.title)).toHaveLength(0)
    expect(await bellsFor(outsider.principalId, entry.id)).toHaveLength(0)
    await admin.dispose()
  }
)

test(
  'CHG-A-15 republishing an unpublished entry, editing or rescheduling it never emails again',
  { tag: '@core' },
  async ({ playwright, request, marker }) => {
    const admin = await personApi(playwright, 'admin')
    const sub = await changelogSubscriber(marker)
    const entry = await createEntry(admin, { title: `${marker} republish`, state: 'published' })
    await waitForMail({ to: sub.email, subject: entry.title })
    await waitForAnnouncementHandled(entry.id)

    await updateEntry(admin, entry.id, { publishState: { type: 'draft' } })
    await updateEntry(admin, entry.id, { publishState: { type: 'published' } })
    await updateEntry(admin, entry.id, { content: `${entry.title} changed a lot.` })
    // Reschedule into the past via the delayed job: make it due and run it.
    const soon = new Date(Date.now() + 60 * 60_000).toISOString()
    await updateEntry(admin, entry.id, { publishState: { type: 'scheduled', publishAt: soon } })
    await supportDb()`UPDATE changelog_entries SET published_at = now() - interval '1 minute'
      WHERE id = ${toUuid(entry.id as `changelog_${string}`)}`
    await makeJobDue(entry.id)
    await runSweep(request, 'changelog-publish')
    await runSweep(request, 'changelog-notify')

    // Control: a fresh entry after it is mailed, so the queue has moved on.
    const control = await createEntry(admin, { title: `${marker} control`, state: 'published' })
    await waitForMail({ to: sub.email, subject: control.title })
    await waitForAnnouncementHandled(control.id)
    expect(await announcementEvents(entry.id)).toBe(1)
    expect(await announcementsTo(sub.email, entry.title)).toHaveLength(1)
    await admin.dispose()
  }
)
