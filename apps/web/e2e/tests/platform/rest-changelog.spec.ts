/**
 * The changelog over the public REST API (/api/v1/changelog): reading,
 * writing, publishing and the announcement it sends, and the key scopes and
 * permissions that guard it.
 *
 * Journeys: API-R-105, API-R-106, API-R-107, API-R-108, API-R-109, API-R-110,
 * API-R-111, API-R-112, API-R-113, API-R-114, API-R-115, API-R-116,
 * API-R-117, API-R-118, API-K-26.
 *
 * Not here: API-R-119 (labels, after #802) and API-R-120 (featuredImageUrl and
 * displayDate on create, after #812) are not in this build; API-R-121 (the
 * module switch) and API-R-112's emails are owner questions.
 *
 * Every entry title carries the test's marker, and lists are read by marker,
 * never by count: other tests publish entries too.
 */
import { generateId } from '@quackback/ids'
import type { APIRequestContext } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import {
  apiFor,
  createKey,
  expectJson,
  newTeammate,
  pageUntilSeen,
  type Wire,
} from '../../support/api-client'
import { supportDb, pollFor } from '../../support/db'
import { mailTo, waitForMail } from '../../support/mailpit'
import { waitForBells, waitForEventHandled } from '../../support/bells'
import {
  adminApi,
  changelogRow,
  eventRows,
  jobRows,
  missingScope,
  rawJson,
  retireSubscribers,
  seedChangelogSubscriber,
  seedPost,
  uuid,
} from '../../product/api-rest-content'

// Key and teammate scripts start the app's modules (about a second each).
test.describe.configure({ timeout: 60_000 })

const ENTRY_KEYS = [
  'content',
  'createdAt',
  'displayDate',
  'id',
  'linkedPosts',
  'publishedAt',
  'title',
  'updatedAt',
]

const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString()

async function createEntry(
  api: APIRequestContext,
  data: Record<string, unknown>,
  status = 201
): Promise<Wire> {
  const body = await expectJson(await api.post('/api/v1/changelog', { data }), status)
  return body.data
}

/** Walk the list (newest first) until every id in `want` is seen. */
async function listIds(
  api: APIRequestContext,
  query: string,
  want: string[]
): Promise<Set<string>> {
  return pageUntilSeen(async (cursor) => {
    const qs = new URLSearchParams(query)
    qs.set('limit', '100')
    if (cursor) qs.set('cursor', cursor)
    const body = await expectJson(await api.get(`/api/v1/changelog?${qs}`), 200)
    return {
      ids: body.data.map((e: { id: string }) => e.id),
      cursor: body.meta.pagination.hasMore ? body.meta.pagination.cursor : null,
    }
  }, want)
}

async function feedBody(api: APIRequestContext): Promise<string> {
  const res = await api.get('/changelog/feed')
  expect(res.status()).toBe(200)
  return res.text()
}

test.describe('REST changelog: reads', () => {
  test(
    'API-R-105 the list returns every entry newest first; published filters drafts and scheduled',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await adminApi(playwright, baseURL, people)
      const draft = await createEntry(api, { title: `${marker} draft`, content: 'Draft body' })
      const published = await createEntry(api, {
        title: `${marker} published`,
        content: 'Published body',
        publishedAt: inMinutes(-1),
      })
      const scheduled = await createEntry(api, {
        title: `${marker} scheduled`,
        content: 'Scheduled body',
        publishedAt: inMinutes(24 * 60),
      })
      const deleted = await createEntry(api, { title: `${marker} deleted`, content: 'Gone' })
      expect((await api.delete(`/api/v1/changelog/${deleted.id}`)).status()).toBe(204)
      const mine = [draft.id, published.id, scheduled.id]

      // Unfiltered: all three, newest createdAt first; never the deleted one.
      const first = await expectJson(await api.get('/api/v1/changelog?limit=100'), 200)
      const all = await listIds(api, '', mine)
      expect([...mine].every((id) => all.has(id))).toBe(true)
      expect(all.has(deleted.id)).toBe(false)
      const order = [...all].filter((id) => mine.includes(id))
      expect(order).toEqual([scheduled.id, published.id, draft.id])
      const item = first.data.find((e: { id: string }) => e.id === published.id)
      expect(Object.keys(item).sort()).toEqual(ENTRY_KEYS)
      expect(item).toMatchObject({
        title: `${marker} published`,
        content: 'Published body',
        displayDate: null,
        linkedPosts: [],
      })

      // published=true: live entries only, so the scheduled one is missing.
      const live = await listIds(api, 'published=true', [published.id])
      expect(live.has(published.id)).toBe(true)
      expect(live.has(draft.id)).toBe(false)
      expect(live.has(scheduled.id)).toBe(false)

      // published=false: drafts only; the scheduled entry is in neither list.
      const drafts = await listIds(api, 'published=false', [draft.id])
      expect(drafts.has(draft.id)).toBe(true)
      expect(drafts.has(published.id)).toBe(false)
      expect(drafts.has(scheduled.id)).toBe(false)
      expect(drafts.has(deleted.id)).toBe(false)
      await api.dispose()
    }
  )

  test(
    'API-R-106 list paging follows the entry-id cursor and caps the limit at 100',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      // 101 old entries guarantee more than a full page exists; dated long ago
      // they sort after everything the other tests create.
      const sql = supportDb()
      const old = Array.from({ length: 101 }, (_, i) => ({
        id: uuid(generateId('changelog')),
        title: `${marker} old ${i}`,
        content: 'Old entry',
        created_at: new Date(Date.UTC(2001, 0, 1, 0, 0, i)),
      }))
      await sql`INSERT INTO changelog_entries ${sql(old)}`
      const { api } = await adminApi(playwright, baseURL, people)
      const a = await createEntry(api, { title: `${marker} a`, content: 'A' })
      const b = await createEntry(api, { title: `${marker} b`, content: 'B' })
      const c = await createEntry(api, { title: `${marker} c`, content: 'C' })

      // limit=2 then the cursor: the cursor is the last entry's id, and the
      // next page starts strictly after it.
      const page1 = await expectJson(await api.get('/api/v1/changelog?limit=2'), 200)
      expect(page1.data).toHaveLength(2)
      expect(page1.meta.pagination.hasMore).toBe(true)
      expect(page1.meta.pagination.cursor).toBe(page1.data[1].id)
      const page2 = await expectJson(
        await api.get(`/api/v1/changelog?limit=2&cursor=${page1.meta.pagination.cursor}`),
        200
      )
      expect(page2.data).toHaveLength(2)
      const page1Ids = page1.data.map((e: { id: string }) => e.id)
      for (const e of page2.data) expect(page1Ids).not.toContain(e.id)
      expect(Date.parse(page2.data[0].createdAt)).toBeLessThanOrEqual(
        Date.parse(page1.data[1].createdAt)
      )
      // Walking from c's id continues with b then a.
      const afterC = await expectJson(
        await api.get(`/api/v1/changelog?limit=100&cursor=${c.id}`),
        200
      )
      const afterIds = afterC.data.map((e: { id: string }) => e.id)
      expect(afterIds).not.toContain(c.id)
      expect(afterIds.indexOf(b.id)).toBeGreaterThanOrEqual(0)
      expect(afterIds.indexOf(b.id)).toBeLessThan(afterIds.indexOf(a.id))

      // limit=500 is capped at 100.
      const big = await expectJson(await api.get('/api/v1/changelog?limit=500'), 200)
      expect(big.data).toHaveLength(100)
      expect(big.meta.pagination.hasMore).toBe(true)

      // A valid id of another type matches no entry: the first page comes back.
      const otherType = await expectJson(
        await api.get(`/api/v1/changelog?limit=2&cursor=${generateId('post')}`),
        200
      )
      expect(otherType.data).toHaveLength(2)
      await api.dispose()
    }
  )

  test(
    'API-R-106 a malformed cursor is refused as bad input, not a server error',
    {
      tag: '@nightly',
    },
    async ({ playwright, baseURL, people }) => {
      const { api } = await adminApi(playwright, baseURL, people)
      const res = await api.get('/api/v1/changelog?cursor=not-an-id')
      expect(res.status(), await res.text()).toBe(400)
      // Positive control: a well-formed cursor answers 200.
      expect((await api.get(`/api/v1/changelog?cursor=${generateId('changelog')}`)).status()).toBe(
        200
      )
      await api.dispose()
    }
  )

  test(
    'API-R-107 get one entry with its markdown image and linked posts; deleted and malformed ids refused',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await adminApi(playwright, baseURL, people)
      const one = await seedPost(marker, `${marker} first post`, 3)
      const two = await seedPost(marker, `${marker} second post`)
      const content = `Shipped it.\n\n![diagram](https://cdn.example.com/${marker}.png)`
      const entry = await createEntry(api, {
        title: `${marker} with image`,
        content,
        linkedPostIds: [one.postId, two.postId],
      })

      const got = await expectJson(await api.get(`/api/v1/changelog/${entry.id}`), 200)
      expect(got.data.id).toBe(entry.id)
      // A draft is returned to a key that may view drafts.
      expect(got.data.publishedAt).toBeNull()
      expect(got.data.content).toContain(`![diagram](https://cdn.example.com/${marker}.png)`)
      expect(
        [...got.data.linkedPosts].sort((x: Wire, y: Wire) => x.title.localeCompare(y.title))
      ).toEqual([
        {
          id: one.postId,
          title: `${marker} first post`,
          voteCount: 3,
          status: { name: one.statusName, color: expect.any(String) },
        },
        {
          id: two.postId,
          title: `${marker} second post`,
          voteCount: 0,
          status: { name: two.statusName, color: expect.any(String) },
        },
      ])

      expect((await api.delete(`/api/v1/changelog/${entry.id}`)).status()).toBe(204)
      const gone = await expectJson(await api.get(`/api/v1/changelog/${entry.id}`), 404)
      expect(gone.error).toMatchObject({ code: 'NOT_FOUND', message: 'Changelog entry not found' })

      for (const bad of ['changelog_bad', generateId('post')]) {
        const res = await expectJson(await api.get(`/api/v1/changelog/${bad}`), 400)
        expect(res.error).toMatchObject({
          code: 'VALIDATION_ERROR',
          message: 'Invalid changelog entry ID format',
        })
      }
      await api.dispose()
    }
  )
})

test.describe('REST changelog: create and publish', () => {
  test(
    'API-R-108 a draft is created by the key, announced to nobody and kept off the feed',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api, principalId } = await adminApi(playwright, baseURL, people)
      const res = await api.post('/api/v1/changelog', {
        data: { title: `${marker} draft`, content: 'Not yet' },
      })
      const body = await expectJson(res, 201)
      expect(Object.keys(body.data).sort()).toEqual(ENTRY_KEYS)
      expect(body.data).toMatchObject({
        title: `${marker} draft`,
        content: 'Not yet',
        publishedAt: null,
        displayDate: null,
        linkedPosts: [],
      })

      const row = await changelogRow(body.data.id)
      expect(row?.principal_id).toBe(uuid(principalId))
      expect(row?.notified_at).toBeNull()
      expect(row?.published_at).toBeNull()
      expect(await eventRows(body.data.id, 'changelog.published')).toEqual([])
      expect(await jobRows(`changelog-publish--${body.data.id}`)).toEqual([])

      const anon = await apiFor(playwright, baseURL, null)
      expect(await feedBody(anon)).not.toContain(`${marker} draft`)
      await anon.dispose()
      await api.dispose()
    }
  )

  test(
    'API-R-109 publishing on create announces once: event, email, bells; a muted subscriber gets only the bell',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const subscriber = await seedChangelogSubscriber(marker, 'sub')
      const muted = await seedChangelogSubscriber(marker, 'muted', { muted: true })
      try {
        const { api } = await adminApi(playwright, baseURL, people)
        const title = `${marker} shipped`
        const publishedAt = new Date(Date.now() - 1000).toISOString()
        const entry = await createEntry(api, {
          title,
          content: 'A new thing for everyone.',
          publishedAt,
        })
        expect(entry.publishedAt).toBe(publishedAt)
        // Live on the public feed right away (read before other publishes can
        // push it past the feed's 50 items).
        const anon = await apiFor(playwright, baseURL, null)
        expect(await feedBody(anon)).toContain(title)
        await anon.dispose()

        await pollFor(
          'notified_at stamped',
          async () => (await changelogRow(entry.id))?.notified_at
        )
        await waitForEventHandled(entry.id, { type: 'changelog.published' })
        const events = await eventRows(entry.id, 'changelog.published')
        expect(events).toHaveLength(1)
        expect(events[0].payload).toMatchObject({
          changelog: {
            id: entry.id,
            title,
            contentPreview: 'A new thing for everyone.',
            linkedPostCount: 0,
          },
        })

        const mail = await waitForMail({ to: subscriber.email, subject: `New update: ${title}` })
        expect(mail.Subject).toBe(`New update: ${title}`)
        expect(mail.HTML).toContain('/changelog')
        expect(mail.HTML).toContain('/unsubscribe?token=')

        for (const who of [subscriber, muted]) {
          const bells = await waitForBells(who.principalId, entry.id, (rows) => rows.length > 0)
          expect(bells.map((b) => [b.type, b.title])).toEqual([
            ['changelog_published', `New update: ${title}`],
          ])
        }
        // The event has been fully handled: an email for the muted one is not coming.
        expect((await mailTo(muted.email)).filter((m) => m.Subject.includes(title))).toEqual([])

        // Re-publishing with the same publishedAt announces nothing again.
        const again = await expectJson(
          await api.patch(`/api/v1/changelog/${entry.id}`, { data: { publishedAt } }),
          200
        )
        expect(again.data.publishedAt).toBe(publishedAt)
        // A later entry's announcement proves the pipeline ran past the PATCH.
        const later = await createEntry(api, {
          title: `${marker} later`,
          content: 'Later',
          publishedAt: new Date(Date.now() - 1000).toISOString(),
        })
        await waitForMail({ to: subscriber.email, subject: `New update: ${marker} later` })
        await waitForEventHandled(later.id, { type: 'changelog.published' })
        expect(await eventRows(entry.id, 'changelog.published')).toHaveLength(1)
        expect(
          (await mailTo(subscriber.email)).filter((m) => m.Subject === `New update: ${title}`)
        ).toHaveLength(1)
        await api.dispose()
      } finally {
        await retireSubscribers([subscriber, muted])
      }
    }
  )

  test(
    'API-R-110 a scheduled entry is announced when it comes due; a deleted one never is',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      // Waits for real delayed jobs to come due.
      test.setTimeout(120_000)
      const subscriber = await seedChangelogSubscriber(marker, 'sub')
      try {
        const { api } = await adminApi(playwright, baseURL, people)
        const title = `${marker} soon`
        const due = new Date(Date.now() + 8_000).toISOString()
        // Scheduled then deleted at once, well inside its window.
        const doomed = await createEntry(api, {
          title: `${marker} doomed`,
          content: 'Never',
          publishedAt: new Date(Date.now() + 6_000).toISOString(),
        })
        expect((await api.delete(`/api/v1/changelog/${doomed.id}`)).status()).toBe(204)
        const entry = await createEntry(api, { title, content: 'Soon', publishedAt: due })

        // Before it is due: scheduled, with a delayed publish job queued, and
        // not among the published entries.
        expect(entry.publishedAt).toBe(due)
        await pollFor('the delayed publish job', async () => {
          const jobs = await jobRows(`changelog-publish--${entry.id}`)
          return jobs.length === 1 && jobs[0].status === 'pending'
        })
        const live = await listIds(api, 'published=true', [])
        expect(live.has(entry.id)).toBe(false)
        expect((await changelogRow(entry.id))?.notified_at).toBeNull()

        // Once due: announced once, with the same email as a direct publish.
        await waitForMail({
          to: subscriber.email,
          subject: `New update: ${title}`,
          timeoutMs: 60_000,
        })
        await waitForEventHandled(entry.id, { type: 'changelog.published' })
        expect(await eventRows(entry.id, 'changelog.published')).toHaveLength(1)

        // The deleted entry's job still ran when due, and announced nothing.
        await pollFor(
          'the deleted entry job to run',
          async () => {
            const jobs = await jobRows(`changelog-publish--${doomed.id}`)
            return jobs.length === 1 && jobs[0].status === 'succeeded'
          },
          { timeoutMs: 20_000 }
        )
        expect(await eventRows(doomed.id, 'changelog.published')).toEqual([])
        expect((await changelogRow(doomed.id))?.notified_at).toBeNull()
        await api.dispose()
      } finally {
        await retireSubscribers([subscriber])
      }
    }
  )

  test(
    'API-R-112 a backdated publish keeps the old date and lists by creation time',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      // The announcement half (import mode still emails) is an owner question.
      const { api } = await adminApi(playwright, baseURL, people)
      const recent = await createEntry(api, { title: `${marker} recent draft`, content: 'Now' })
      const old = await createEntry(api, {
        title: `${marker} from 2021`,
        content: 'History',
        publishedAt: '2021-01-01T00:00:00.000Z',
      })
      expect(old.publishedAt).toBe('2021-01-01T00:00:00.000Z')
      const order = [...(await listIds(api, '', [recent.id, old.id]))].filter((id) =>
        [recent.id, old.id].includes(id)
      )
      expect(order).toEqual([old.id, recent.id])
      const live = await listIds(api, 'published=true', [old.id])
      expect(live.has(old.id)).toBe(true)
      await api.dispose()
    }
  )
})

test.describe('REST changelog: update and delete', () => {
  test(
    'API-R-113 PATCH edits fields, replaces links and moves an entry between draft, scheduled and published',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api, principalId } = await adminApi(playwright, baseURL, people)
      const { api: other, principalId: otherPrincipal } = await adminApi(
        playwright,
        baseURL,
        people
      )
      const a = await seedPost(marker, `${marker} a`)
      const b = await seedPost(marker, `${marker} b`)
      const patch = (id: string, data: Record<string, unknown>) =>
        other.patch(`/api/v1/changelog/${id}`, { data })

      // 1: a title edit on a published entry moves updatedAt and announces nothing new.
      const published = await createEntry(api, {
        title: `${marker} live`,
        content: 'Live',
        publishedAt: new Date(Date.now() - 1000).toISOString(),
      })
      await waitForEventHandled(published.id, { type: 'changelog.published' })
      const renamed = await expectJson(
        await patch(published.id, { title: `${marker} live v2` }),
        200
      )
      expect(renamed.data.title).toBe(`${marker} live v2`)
      expect(Date.parse(renamed.data.updatedAt)).toBeGreaterThan(Date.parse(published.updatedAt))
      expect(renamed.data.publishedAt).toBe(published.publishedAt)

      // 2: links are replaced wholesale, kept when omitted, cleared by [].
      const linked = await expectJson(
        await patch(published.id, { linkedPostIds: [a.postId, b.postId] }),
        200
      )
      expect(linked.data.linkedPosts.map((p: Wire) => p.id).sort()).toEqual(
        [a.postId, b.postId].sort()
      )
      const kept = await expectJson(await patch(published.id, { content: 'Live, edited' }), 200)
      expect(kept.data.linkedPosts).toHaveLength(2)
      expect(kept.data.content).toBe('Live, edited')
      const cleared = await expectJson(await patch(published.id, { linkedPostIds: [] }), 200)
      expect(cleared.data.linkedPosts).toEqual([])
      expect(await eventRows(published.id, 'changelog.published')).toHaveLength(1)

      // 3: un-scheduling makes a draft and cancels the pending publish job.
      const scheduled = await createEntry(api, {
        title: `${marker} scheduled`,
        content: 'Later',
        publishedAt: inMinutes(60),
      })
      await pollFor('the scheduled job', async () =>
        (await jobRows(`changelog-publish--${scheduled.id}`)).length === 1 ? true : null
      )
      const unscheduled = await expectJson(await patch(scheduled.id, { publishedAt: null }), 200)
      expect(unscheduled.data.publishedAt).toBeNull()
      await pollFor('the scheduled job cancelled', async () =>
        (await jobRows(`changelog-publish--${scheduled.id}`)).length === 0 ? true : null
      )

      // 4: a draft published at a past date is announced once, as whoever published it.
      const draft = await createEntry(api, { title: `${marker} draft`, content: 'Draft' })
      const past = '2024-05-01T12:00:00.000Z'
      const pub = await expectJson(await patch(draft.id, { publishedAt: past }), 200)
      expect(pub.data.publishedAt).toBe(past)
      await waitForEventHandled(draft.id, { type: 'changelog.published' })
      const events = await eventRows(draft.id, 'changelog.published')
      expect(events).toHaveLength(1)
      expect(events[0].actor_id).toBe(otherPrincipal)
      expect(events[0].actor_id).not.toBe(principalId)

      // 5: a future date on a draft schedules it.
      const draft2 = await createEntry(api, { title: `${marker} draft2`, content: 'Draft' })
      const future = inMinutes(90)
      const sched = await expectJson(await patch(draft2.id, { publishedAt: future }), 200)
      expect(sched.data.publishedAt).toBe(future)
      await pollFor('the new scheduled job', async () =>
        (await jobRows(`changelog-publish--${draft2.id}`)).length === 1 ? true : null
      )

      // 6: a deleted entry is not found.
      expect((await api.delete(`/api/v1/changelog/${draft2.id}`)).status()).toBe(204)
      const gone = await expectJson(await patch(draft2.id, { title: 'x' }), 404)
      expect(gone.error).toMatchObject({ code: 'NOT_FOUND', message: 'Changelog entry not found' })
      await api.dispose()
      await other.dispose()
    }
  )

  test(
    'API-R-114 a display date is set only on a published entry, never in the future, and clears with null',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await adminApi(playwright, baseURL, people)
      const published = await createEntry(api, {
        title: `${marker} live`,
        content: 'Live',
        publishedAt: new Date(Date.now() - 1000).toISOString(),
      })
      const draft = await createEntry(api, { title: `${marker} draft`, content: 'Draft' })
      const pastDate = '2024-02-03T00:00:00.000Z'

      const set = await expectJson(
        await api.patch(`/api/v1/changelog/${published.id}`, { data: { displayDate: pastDate } }),
        200
      )
      expect(set.data.displayDate).toBe(pastDate)

      const future = await expectJson(
        await api.patch(`/api/v1/changelog/${published.id}`, {
          data: { displayDate: inMinutes(3 * 24 * 60) },
        }),
        400
      )
      expect(future.error).toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'Display date cannot be in the future',
      })

      const onDraft = await expectJson(
        await api.patch(`/api/v1/changelog/${draft.id}`, { data: { displayDate: pastDate } }),
        400
      )
      expect(onDraft.error).toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'Display date can only be set on published changelog entries',
      })

      const cleared = await expectJson(
        await api.patch(`/api/v1/changelog/${published.id}`, { data: { displayDate: null } }),
        200
      )
      expect(cleared.data.displayDate).toBeNull()
      expect((await changelogRow(published.id))?.display_date).toBeNull()
      await api.dispose()
    }
  )

  test(
    'API-R-115 DELETE soft-deletes once; the entry leaves the list and the feed',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await adminApi(playwright, baseURL, people)
      const title = `${marker} to delete`
      const entry = await createEntry(api, {
        title,
        content: 'Bye',
        publishedAt: new Date(Date.now() - 1000).toISOString(),
      })
      await waitForEventHandled(entry.id, { type: 'changelog.published' })
      const anon = await apiFor(playwright, baseURL, null)
      expect(await feedBody(anon)).toContain(title)

      const res = await api.delete(`/api/v1/changelog/${entry.id}`)
      expect(res.status()).toBe(204)
      expect(await res.text()).toBe('')
      const again = await expectJson(await api.delete(`/api/v1/changelog/${entry.id}`), 404)
      expect(again.error).toMatchObject({ code: 'NOT_FOUND', message: 'Changelog entry not found' })
      const get = await expectJson(await api.get(`/api/v1/changelog/${entry.id}`), 404)
      expect(get.error.code).toBe('NOT_FOUND')

      const row = await changelogRow(entry.id)
      expect(row?.deleted_at).not.toBeNull()
      expect(row?.published_at?.toISOString()).toBe(entry.publishedAt)
      const all = await listIds(api, '', [])
      expect(all.has(entry.id)).toBe(false)
      expect(await feedBody(anon)).not.toContain(title)
      // No event for the delete: the publish is the entry's only event.
      const types = await supportDb()<{ type: string }[]>`
        SELECT type FROM events WHERE entity_id = ${entry.id} ORDER BY id`
      expect(types.map((t) => t.type)).toEqual(['changelog.published'])
      await anon.dispose()
      await api.dispose()
    }
  )
})

test.describe('REST changelog: validation', () => {
  test(
    'API-R-111 create and update validation answers 400 with the field or the rule',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await adminApi(playwright, baseURL, people)
      const invalidBody = async (data: Record<string, unknown>, field: string) => {
        const res = await expectJson(await api.post('/api/v1/changelog', { data }), 400)
        expect(res.error).toMatchObject({ code: 'BAD_REQUEST', message: 'Invalid request body' })
        expect(Object.keys(res.error.details.errors)).toEqual([field])
      }
      await invalidBody({ content: 'No title' }, 'title')
      await invalidBody({ title: 'x'.repeat(201), content: 'Long' }, 'title')
      await invalidBody(
        { title: `${marker} date`, content: 'x', publishedAt: 'yesterday' },
        'publishedAt'
      )

      const blank = await expectJson(
        await api.post('/api/v1/changelog', { data: { title: `${marker} blank`, content: '   ' } }),
        400
      )
      expect(blank.error).toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'Content is required',
      })

      const badLink = await expectJson(
        await api.post('/api/v1/changelog', {
          data: { title: `${marker} bad link`, content: 'x', linkedPostIds: ['nope'] },
        }),
        400
      )
      expect(badLink.error).toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'Invalid linked post IDs format',
      })

      // A well-formed id that names no post is dropped silently.
      const unknown = await createEntry(api, {
        title: `${marker} unknown link`,
        content: 'x',
        linkedPostIds: [generateId('post')],
      })
      expect(unknown.linkedPosts).toEqual([])

      const emptyTitle = await expectJson(
        await api.patch(`/api/v1/changelog/${unknown.id}`, { data: { title: '  ' } }),
        400
      )
      expect(emptyTitle.error).toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'Title cannot be empty',
      })
      // None of the refused creates left a row.
      const [{ n }] = await supportDb()<{ n: number }[]>`
        SELECT count(*)::int AS n FROM changelog_entries WHERE title LIKE ${`${marker}%`}`
      expect(n).toBe(1)
      await api.dispose()
    }
  )

  test(
    'API-R-111 a body that is not JSON is refused as bad input, not a server error',
    {
      tag: '@nightly',
    },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await adminApi(playwright, baseURL, people)
      const entry = await createEntry(api, { title: `${marker} target`, content: 'x' })
      for (const res of [
        await rawJson(api, 'post', '/api/v1/changelog'),
        await rawJson(api, 'patch', `/api/v1/changelog/${entry.id}`),
      ]) {
        expect(res.status(), await res.text()).toBe(400)
      }
      await api.dispose()
    }
  )
})

test.describe('REST changelog: scopes and permissions', () => {
  test(
    'API-R-116 a changelog-only key writes but cannot read',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await adminApi(playwright, baseURL, people, { scopes: ['write:changelog'] })
      const created = await createEntry(api, { title: `${marker} write only`, content: 'W' })
      expect(created.title).toBe(`${marker} write only`)
      const patched = await expectJson(
        await api.patch(`/api/v1/changelog/${created.id}`, { data: { content: 'W2' } }),
        200
      )
      expect(patched.data).toMatchObject({ id: created.id, content: 'W2' })

      for (const path of ['/api/v1/changelog', `/api/v1/changelog/${created.id}`]) {
        const res = await expectJson(await api.get(path), 403)
        expect(res.error).toMatchObject({
          code: 'FORBIDDEN',
          message: missingScope('read:feedback', 'changelog.view_draft'),
        })
      }
      // Positive control: a key with read:feedback reads the same entry.
      const { api: reader } = await adminApi(playwright, baseURL, people, {
        scopes: ['read:feedback'],
      })
      const read = await expectJson(await reader.get(`/api/v1/changelog/${created.id}`), 200)
      expect(read.data.content).toBe('W2')
      await reader.dispose()
      await api.dispose()
    }
  )

  test(
    'API-K-26 a write-only changelog key cannot read the draft it just wrote, but can edit it',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api } = await adminApi(playwright, baseURL, people, { scopes: ['write:changelog'] })
      const draft = await createEntry(api, { title: `${marker} draft`, content: 'D' })
      expect(draft.publishedAt).toBeNull()
      for (const path of ['/api/v1/changelog', `/api/v1/changelog/${draft.id}`]) {
        const res = await expectJson(await api.get(path), 403)
        expect(res.error.message).toBe(missingScope('read:feedback', 'changelog.view_draft'))
      }
      const patched = await expectJson(
        await api.patch(`/api/v1/changelog/${draft.id}`, { data: { title: `${marker} draft 2` } }),
        200
      )
      expect(patched.data.title).toBe(`${marker} draft 2`)
      await api.dispose()
    }
  )

  test(
    'API-R-117 writes are refused without write:changelog or without changelog.manage; nothing changes',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const { api: admin } = await adminApi(playwright, baseURL, people)
      const entry = await createEntry(admin, { title: `${marker} target`, content: 'Original' })

      // (a) feedback scopes only.
      const { api: feedbackKey } = await adminApi(playwright, baseURL, people, {
        scopes: ['read:feedback', 'write:feedback'],
      })
      // (b) a personal key whose creator may view drafts but not manage.
      const viewer = newTeammate(`Changelog viewer ${marker}`, ['changelog.view_draft'])
      const personal = createKey({ creatorEmail: viewer.email, kind: 'personal' })
      const viewerApi = await apiFor(playwright, baseURL, personal.key)

      const refusals: Array<[APIRequestContext, string]> = [
        [feedbackKey, missingScope('write:changelog', 'changelog.manage')],
        [viewerApi, "Requires the 'changelog.manage' permission"],
      ]
      for (const [api, message] of refusals) {
        const attempts = [
          api.post('/api/v1/changelog', { data: { title: `${marker} refused`, content: 'x' } }),
          api.patch(`/api/v1/changelog/${entry.id}`, { data: { title: `${marker} hijacked` } }),
          api.delete(`/api/v1/changelog/${entry.id}`),
        ]
        for (const res of await Promise.all(attempts)) {
          const body = await expectJson(res, 403)
          expect(body.error).toMatchObject({ code: 'FORBIDDEN', message })
        }
        // Both keys still read.
        const read = await expectJson(await api.get(`/api/v1/changelog/${entry.id}`), 200)
        expect(read.data.title).toBe(`${marker} target`)
      }
      const [{ n }] = await supportDb()<{ n: number }[]>`
        SELECT count(*)::int AS n FROM changelog_entries WHERE title LIKE ${`${marker}%`}`
      expect(n).toBe(1)
      expect((await changelogRow(entry.id))?.deleted_at).toBeNull()

      // Positive control: the admin key's PATCH goes through.
      const ok = await expectJson(
        await admin.patch(`/api/v1/changelog/${entry.id}`, { data: { title: `${marker} edited` } }),
        200
      )
      expect(ok.data.title).toBe(`${marker} edited`)
      for (const api of [admin, feedbackKey, viewerApi]) await api.dispose()
    }
  )

  test(
    'API-R-118 the UI-only targeting, label, image and notify fields are dropped without an error',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      // Whether a REST publish should honour notify:false is an owner question
      // (see API-R-112), so the entry stays a draft and nobody is mailed.
      const { api } = await adminApi(playwright, baseURL, people)
      const entry = await createEntry(api, {
        title: `${marker} extra fields`,
        content: 'Extras',
        notify: false,
        segmentIds: [generateId('segment')],
        categoryIds: [generateId('changelog_category')],
        featuredImageUrl: 'https://cdn.example.com/hero.png',
      })
      expect(Object.keys(entry).sort()).toEqual(ENTRY_KEYS)
      const [row] = await supportDb()<
        { segment_ids: unknown; featured_image_url: string | null; labels: number }[]
      >`SELECT segment_ids, featured_image_url,
          (SELECT count(*)::int FROM changelog_entry_categories c
           WHERE c.changelog_entry_id = e.id) AS labels
        FROM changelog_entries e WHERE id = ${uuid(entry.id)}`
      expect(row).toEqual({ segment_ids: [], featured_image_url: null, labels: 0 })
      await api.dispose()
    }
  )
})
