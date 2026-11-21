/**
 * Managing outgoing webhooks over REST and in Settings > Developers >
 * Webhooks. Journeys API-W-01, 02, 03, 04, 05, 07, 08, 09, 10, 11, 12, 13,
 * 14, 15, 18, 19, 22, 23, 24, 25, 26, 27.
 *
 * Every test deletes its own webhooks in `finally` (the 25-webhook cap is
 * workspace-wide) and reads only its own sink channels and ids.
 */
import { createHmac } from 'node:crypto'
import type { Page } from '@playwright/test'
import { generateId, toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { apiFor, createKey, newTeammate as roleTeammate } from '../../support/api-client'
import { sink } from '../../support/webhook-sink-client'
import { expectSigned, unsubscribe } from '../../support/webhooks'
import {
  adminApi,
  delivered,
  createHook,
  expectNone,
  getHook,
  is,
  json,
  newBoard,
  newPost,
  setHookCounters,
  withHook,
  withHooks,
  type Json,
} from '../../product/webhooks'

test.describe.configure({ timeout: 60_000 })

test.describe('webhooks over REST', () => {
  test(
    'API-W-01 creating a feedback webhook returns its secret once and stores it encrypted',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const key = createKey({ creatorEmail: people.people.admin.email, kind: 'personal' })
      const api = await apiFor(playwright, baseURL, key.key)
      const board = await newBoard(api, marker)
      let id: string | undefined
      try {
        const res = await api.post('/api/v1/webhooks', {
          data: {
            url: sink.url(marker),
            events: ['post.created', 'comment.created'],
            boardIds: [board.id],
          },
        })
        const { data } = await json<{ data: Json }>(res, 201)
        id = data.id as string
        expect(data).toEqual({
          id: expect.stringMatching(/^webhook_/),
          url: sink.url(marker),
          secret: expect.stringMatching(/^whsec_[A-Za-z0-9_-]{43}$/),
          events: ['post.created', 'comment.created'],
          boardIds: [board.id],
          status: 'active',
          createdAt: expect.any(String),
        })

        const got = await getHook(api, id)
        expect(got).toEqual({
          id,
          url: sink.url(marker),
          events: ['post.created', 'comment.created'],
          boardIds: [board.id],
          status: 'active',
          failureCount: 0,
          lastError: null,
          lastTriggeredAt: null,
          createdAt: data.createdAt,
          updatedAt: expect.any(String),
        })
        expect(got).not.toHaveProperty('secret')

        const [row] = await supportDb()`SELECT created_by_id, secret FROM webhooks
          WHERE id = ${toUuid(id as `webhook_${string}`)}`
        expect(row.created_by_id).toBe(toUuid(key.principalId as `principal_${string}`))
        expect(row.secret).not.toBe(data.secret)
        expect(String(row.secret)).not.toContain(String(data.secret).slice(6))
      } finally {
        if (id) await api.delete(`/api/v1/webhooks/${id}`)
        await api.dispose()
      }
    }
  )

  test(
    'API-W-02 a malformed board id is refused and nothing is written',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      try {
        for (const bad of ['invalid-board-id', generateId('post')]) {
          const res = await api.post('/api/v1/webhooks', {
            data: { url: sink.url(marker), events: ['post.created'], boardIds: [bad] },
          })
          const body = await json<{ error: Json }>(res, 400)
          expect(body.error).toMatchObject({
            code: 'VALIDATION_ERROR',
            message: 'Invalid board IDs format',
          })
        }
        const rows = await supportDb()`SELECT id FROM webhooks WHERE url = ${sink.url(marker)}`
        expect(rows).toHaveLength(0)
      } finally {
        await api.dispose()
      }
    }
  )

  test(
    'API-W-03 audit-only and unknown event names are refused',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      try {
        for (const event of [
          'board.created',
          'tag.created',
          'article.published',
          'company.created',
          'settings.updated',
          'post.exploded',
        ]) {
          const res = await api.post('/api/v1/webhooks', {
            data: { url: sink.url(marker), events: [event] },
          })
          const body = await json<{ error: { code: string; message: string; details: Json } }>(
            res,
            400
          )
          expect(body.error.code, event).toBe('BAD_REQUEST')
          expect(body.error.message, event).toBe('Invalid request body')
          expect(JSON.stringify(body.error.details), event).toContain('"events"')
        }
        const rows = await supportDb()`SELECT id FROM webhooks WHERE url = ${sink.url(marker)}`
        expect(rows).toHaveLength(0)
      } finally {
        await api.dispose()
      }
    }
  )

  test(
    'API-W-04 a well-formed board id that does not exist is stored and matches nothing',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      const board = await newBoard(api, marker)
      const ghost = generateId('board')
      const control = `${marker}-ctl`
      try {
        await withHooks(
          api,
          [
            { channel: marker, events: ['post.created'], boardIds: [ghost] },
            { channel: control, events: ['post.created'] },
          ],
          async ([filtered]) => {
            expect(filtered.boardIds).toEqual([ghost])
            const post = await newPost(api, board.id, `Ghost board ${marker}`)
            await delivered(control, 'post.created', post.id)
            await expectNone(marker, is('post.created', post.id), 'no board matches the filter')
          }
        )
      } finally {
        await api.dispose()
      }
    }
  )

  test(
    'API-W-05 webhook management rides the settings scopes and the admin permissions',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = people.people.admin.email
      const readOnly = await apiFor(
        playwright,
        baseURL,
        createKey({ creatorEmail: admin, kind: 'personal', scopes: ['read:settings'] }).key
      )
      // Feedback scopes no longer manage webhooks: a webhook can carry any domain's events.
      const feedbackOnly = await apiFor(
        playwright,
        baseURL,
        createKey({
          creatorEmail: admin,
          kind: 'personal',
          scopes: ['read:feedback', 'write:feedback'],
        }).key
      )
      const chatOnly = await apiFor(
        playwright,
        baseURL,
        createKey({ creatorEmail: admin, kind: 'personal', scopes: ['read:chat', 'write:chat'] })
          .key
      )
      const contributor = await apiFor(
        playwright,
        baseURL,
        createKey({ creatorEmail: people.people.contributor.email, kind: 'personal' }).key
      )
      const legacy = await apiFor(
        playwright,
        baseURL,
        createKey({ creatorEmail: admin, kind: 'personal', legacy: true }).key
      )
      let id: string | undefined
      try {
        const refusedCreate = await readOnly.post('/api/v1/webhooks', {
          data: { url: sink.url(marker), events: ['post.created'] },
        })
        expect((await json<{ error: Json }>(refusedCreate, 403)).error).toEqual({
          code: 'FORBIDDEN',
          message:
            "This API key is missing the 'write:settings' scope required by 'webhook.manage'",
        })
        await json(await readOnly.get('/api/v1/webhooks'), 200)

        const feedbackCreate = await feedbackOnly.post('/api/v1/webhooks', {
          data: { url: sink.url(marker), events: ['post.created'] },
        })
        expect((await json<{ error: Json }>(feedbackCreate, 403)).error.message).toBe(
          "This API key is missing the 'write:settings' scope required by 'webhook.manage'"
        )
        expect(
          (await json<{ error: Json }>(await feedbackOnly.get('/api/v1/webhooks'), 403)).error
            .message
        ).toBe("This API key is missing the 'read:settings' scope required by 'webhook.view'")

        expect(
          (await json<{ error: Json }>(await chatOnly.get('/api/v1/webhooks'), 403)).error.message
        ).toBe("This API key is missing the 'read:settings' scope required by 'webhook.view'")

        expect(
          (await json<{ error: Json }>(await contributor.get('/api/v1/webhooks'), 403)).error
            .message
        ).toBe("Requires the 'webhook.view' permission")

        // The legacy (NULL scope) admin key passes every gate.
        id = (await createHook(legacy, marker, ['post.created'])).id
        await json(await legacy.get(`/api/v1/webhooks/${id}`), 200)

        const rotate = await readOnly.post(`/api/v1/webhooks/${id}/rotate`)
        expect((await json<{ error: Json }>(rotate, 403)).error.message).toBe(
          "This API key is missing the 'write:settings' scope required by 'webhook.manage'"
        )
        await json(await legacy.post(`/api/v1/webhooks/${id}/rotate`), 200)
      } finally {
        if (id) await legacy.delete(`/api/v1/webhooks/${id}`)
        for (const a of [readOnly, feedbackOnly, chatOnly, contributor, legacy]) await a.dispose()
      }
    }
  )

  test(
    'API-W-07 the list is newest first, leaves out deleted webhooks and never shows secrets',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      try {
        await withHooks(
          api,
          [
            { channel: `${marker}-1`, events: ['post.created'] },
            { channel: `${marker}-2`, events: ['post.voted'] },
            { channel: `${marker}-3`, events: ['post.deleted'] },
          ],
          async ([older, newer, gone]) => {
            await json(await api.delete(`/api/v1/webhooks/${gone.id}`), 204)
            await setHookCounters(newer.id, { failureCount: 2, lastError: 'HTTP 500' })
            const body = await json<{ data: Json[]; meta?: Json }>(
              await api.get('/api/v1/webhooks'),
              200
            )
            expect(body.meta?.pagination).toBeUndefined()
            const ids = body.data.map((w) => w.id)
            expect(ids).not.toContain(gone.id)
            expect(ids.indexOf(newer.id)).toBeGreaterThanOrEqual(0)
            expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id))
            const item = body.data.find((w) => w.id === newer.id)
            expect(Object.keys(item ?? {}).sort()).toEqual(
              [
                'boardIds',
                'createdAt',
                'events',
                'failureCount',
                'id',
                'lastTriggeredAt',
                'status',
                'updatedAt',
                'url',
              ].sort()
            )
            expect(item?.failureCount).toBe(2)
          }
        )
      } finally {
        await api.dispose()
      }
    }
  )

  test(
    'API-W-08 one webhook: full shape with lastError, a bad id and an unknown id',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      try {
        await withHook(api, marker, ['post.created'], async (hook) => {
          await setHookCounters(hook.id, { failureCount: 1, lastError: 'HTTP 503' })
          expect(await getHook(api, hook.id)).toMatchObject({
            id: hook.id,
            failureCount: 1,
            lastError: 'HTTP 503',
          })
        })
        for (const bad of ['not-a-typeid', generateId('post')]) {
          const res = await api.get(`/api/v1/webhooks/${bad}`)
          expect((await json<{ error: Json }>(res, 400)).error).toEqual({
            code: 'VALIDATION_ERROR',
            message: 'Invalid webhook ID format',
          })
        }
        const missing = await api.get(`/api/v1/webhooks/${generateId('webhook')}`)
        expect((await json<{ error: Json }>(missing, 404)).error).toEqual({
          code: 'NOT_FOUND',
          message: 'Webhook not found',
        })
      } finally {
        await api.dispose()
      }
    }
  )

  test(
    'API-W-09 a deleted webhook reads as not found',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      try {
        const hook = await createHook(api, marker, ['post.created'])
        expect((await api.delete(`/api/v1/webhooks/${hook.id}`)).status()).toBe(204)
        const res = await api.get(`/api/v1/webhooks/${hook.id}`)
        expect((await json<{ error: Json }>(res, 404)).error.message).toBe('Webhook not found')
      } finally {
        await api.dispose()
      }
    }
  )

  test(
    'API-W-10 a deleted webhook cannot be updated or rotated; a second delete is 404',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      try {
        const hook = await createHook(api, marker, ['post.created'])
        expect((await api.delete(`/api/v1/webhooks/${hook.id}`)).status()).toBe(204)
        const again = await api.delete(`/api/v1/webhooks/${hook.id}`)
        expect((await json<{ error: Json }>(again, 404)).error.message).toBe('Webhook not found')
        const patch = await api.patch(`/api/v1/webhooks/${hook.id}`, {
          data: { status: 'active' },
        })
        expect((await json<{ error: Json }>(patch, 404)).error.message).toBe('Webhook not found')
        const rotate = await api.post(`/api/v1/webhooks/${hook.id}/rotate`)
        expect((await json<{ error: Json }>(rotate, 404)).error.message).toBe('Webhook not found')
      } finally {
        await api.dispose()
      }
    }
  )

  test(
    'API-W-11 a partial update moves the URL and clears the board filter; bad values are refused',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      const board = await newBoard(api, marker)
      const moved = `${marker}-b`
      try {
        await withHook(
          api,
          marker,
          ['post.created'],
          async (hook) => {
            const before = await getHook(api, hook.id)
            await new Promise((r) => setTimeout(r, 20))
            const patched = (
              await json<{ data: Json }>(
                await api.patch(`/api/v1/webhooks/${hook.id}`, { data: { url: sink.url(moved) } }),
                200
              )
            ).data
            expect(patched).toMatchObject({
              id: hook.id,
              url: sink.url(moved),
              events: ['post.created'],
              boardIds: [board.id],
              status: 'active',
            })
            expect(Date.parse(String(patched.updatedAt))).toBeGreaterThan(
              Date.parse(String(before.updatedAt))
            )

            const post = await newPost(api, board.id, `Moved ${marker}`)
            await delivered(moved, 'post.created', post.id)
            expect(await sink.deliveries(marker)).toEqual([])

            const cleared = (
              await json<{ data: Json }>(
                await api.patch(`/api/v1/webhooks/${hook.id}`, { data: { boardIds: null } }),
                200
              )
            ).data
            expect(cleared.boardIds).toBeNull()

            const empty = await api.patch(`/api/v1/webhooks/${hook.id}`, { data: { events: [] } })
            const emptyBody = await json<{ error: Json }>(empty, 400)
            expect(emptyBody.error.code).toBe('BAD_REQUEST')
            expect(JSON.stringify(emptyBody)).toContain('At least one event is required')

            const http = await api.patch(`/api/v1/webhooks/${hook.id}`, {
              data: { url: sink.url(moved).replace('https://', 'http://') },
            })
            expect((await json<{ error: Json }>(http, 400)).error).toEqual({
              code: 'VALIDATION_ERROR',
              message: 'Invalid webhook URL: must be HTTPS and cannot target private networks',
            })
            expect((await getHook(api, hook.id)).url).toBe(sink.url(moved))
          },
          [board.id]
        )
      } finally {
        await api.dispose()
      }
    }
  )

  test(
    'API-W-12 a disabled webhook gets nothing; re-enabling resets its failures and resumes',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      const board = await newBoard(api, marker)
      const control = `${marker}-ctl`
      try {
        await withHooks(
          api,
          [
            { channel: marker, events: ['post.created'], boardIds: [board.id] },
            { channel: control, events: ['post.created'], boardIds: [board.id] },
          ],
          async ([hook]) => {
            const off = await api.patch(`/api/v1/webhooks/${hook.id}`, {
              data: { status: 'disabled' },
            })
            expect((await json<{ data: Json }>(off, 200)).data.status).toBe('disabled')
            const quiet = await newPost(api, board.id, `While off ${marker}`)
            await delivered(control, 'post.created', quiet.id)
            await expectNone(marker, is('post.created', quiet.id), 'disabled webhook')

            await setHookCounters(hook.id, { failureCount: 7, lastError: 'HTTP 500' })
            const on = await api.patch(`/api/v1/webhooks/${hook.id}`, {
              data: { status: 'active' },
            })
            expect((await json<{ data: Json }>(on, 200)).data).toMatchObject({
              status: 'active',
              failureCount: 0,
              lastError: null,
            })
            const live = await newPost(api, board.id, `Back on ${marker}`)
            await delivered(marker, 'post.created', live.id)
          }
        )
      } finally {
        await api.dispose()
      }
    }
  )

  test(
    'API-W-13 a deleted webhook stops receiving and leaves the list, kept as a soft delete',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      const board = await newBoard(api, marker)
      const control = `${marker}-ctl`
      const hook = await createHook(api, marker, ['post.created'], [board.id])
      const controlHook = await createHook(api, control, ['post.created'], [board.id])
      try {
        const first = await newPost(api, board.id, `Before delete ${marker}`)
        await delivered(marker, 'post.created', first.id)

        const del = await api.delete(`/api/v1/webhooks/${hook.id}`)
        expect(del.status()).toBe(204)
        expect(await del.text()).toBe('')

        const second = await newPost(api, board.id, `After delete ${marker}`)
        await delivered(control, 'post.created', second.id)
        await expectNone(marker, is('post.created', second.id), 'deleted webhook')

        const list = await json<{ data: Json[] }>(await api.get('/api/v1/webhooks'), 200)
        expect(list.data.map((w) => w.id)).not.toContain(hook.id)
        const [row] = await supportDb()`SELECT deleted_at FROM webhooks
          WHERE id = ${toUuid(hook.id as `webhook_${string}`)}`
        expect(row.deleted_at).not.toBeNull()
      } finally {
        await unsubscribe(api, controlHook)
        await api.dispose()
      }
    }
  )

  test(
    'API-W-14 rotating the secret signs the next delivery with the new secret only',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      const board = await newBoard(api, marker)
      try {
        await withHook(
          api,
          marker,
          ['post.created'],
          async (hook) => {
            const res = await api.post(`/api/v1/webhooks/${hook.id}/rotate`)
            const { data } = await json<{ data: Json }>(res, 200)
            expect(data).toEqual({
              id: hook.id,
              secret: expect.stringMatching(/^whsec_[A-Za-z0-9_-]{43}$/),
              rotatedAt: expect.any(String),
            })
            expect(data.secret).not.toBe(hook.secret)

            const post = await newPost(api, board.id, `Rotated ${marker}`)
            const [d] = await delivered(marker, 'post.created', post.id)
            expectSigned(d, String(data.secret))
            const ts = d.headers['x-quackback-timestamp']
            const old = createHmac('sha256', hook.secret).update(`${ts}.${d.body}`).digest('hex')
            expect(d.headers['x-quackback-signature']).not.toBe(`sha256=${old}`)
          },
          [board.id]
        )
      } finally {
        await api.dispose()
      }
    }
  )

  test(
    'API-W-15 a malformed JSON body is a bad request',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      try {
        await withHook(api, marker, ['post.created'], async (hook) => {
          for (const [method, path] of [
            ['post', '/api/v1/webhooks'],
            ['patch', `/api/v1/webhooks/${hook.id}`],
          ] as const) {
            const res = await api[method](path, {
              headers: { 'content-type': 'application/json' },
              data: '{url:',
            })
            expect((await json<{ error: Json }>(res, 400)).error.code, path).toBe('BAD_REQUEST')
          }
        })
      } finally {
        await api.dispose()
      }
    }
  )
})

const WEBHOOKS_TAB = '/admin/settings/developers?tab=webhooks'

/** The settings row of the webhook whose URL is `url`. */
function rowOf(page: Page, url: string) {
  return page
    .locator('[data-slot="settings-list-row"]')
    .filter({ has: page.getByText(url, { exact: true }) })
}

/*
 * A press that lands before the tab has hydrated does nothing, so the two
 * openers below press again until the menu or dialog is there.
 */
async function openRowAction(page: Page, url: string, action: 'Edit' | 'Delete') {
  const item = page.getByRole('menuitem', { name: action })
  await expect(async () => {
    if (!(await item.isVisible())) {
      await page.getByRole('button', { name: `Actions for ${url}`, exact: true }).click()
    }
    await expect(item).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 20_000 })
  await item.click()
}

async function openNewWebhook(page: Page) {
  const dialog = page.getByRole('dialog')
  await expect(async () => {
    if (!(await dialog.isVisible())) {
      await page.getByRole('button', { name: 'New webhook' }).click()
    }
    await expect(dialog.getByLabel('Endpoint URL')).toBeVisible({ timeout: 3_000 })
  }).toPass({ timeout: 20_000 })
  return dialog
}

/** A role holding exactly `permissions`; returns its key for the newTeammate fixture. */
function customRole(marker: string, suffix: string, permissions: string[]): string {
  const name = `Hooks ${marker} ${suffix}`
  roleTeammate(name, permissions)
  return `e2e_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`
}

test.describe('webhooks in Settings > Developers', () => {
  test(
    'API-W-18 an admin creates a webhook in the UI and sees the secret once',
    { tag: '@core' },
    async ({ asPerson, playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      const url = sink.url(marker)
      const page = await asPerson('admin')
      try {
        await page.goto(WEBHOOKS_TAB)
        const dialog = await openNewWebhook(page)
        const submit = dialog.getByRole('button', { name: 'Create webhook' })
        await expect(submit).toBeDisabled()
        await dialog.getByLabel('Endpoint URL').fill(url)
        await expect(submit).toBeDisabled()
        await dialog.getByRole('checkbox', { name: 'Subscribe to New Post Created events' }).click()
        await dialog
          .getByRole('checkbox', { name: 'Subscribe to Changelog Published events' })
          .click()
        await submit.click()

        await expect(dialog.getByRole('heading', { name: 'Webhook created' })).toBeVisible()
        await expect(
          dialog.getByText("Save your signing secret now. You won't be able to see it again.")
        ).toBeVisible()
        await expect(dialog.getByText('Signing secret', { exact: true })).toBeVisible()
        const secret = (await dialog.getByText(/^whsec_/).textContent())?.trim() ?? ''
        expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/)
        await dialog.getByRole('button', { name: "I've saved my secret" }).click()
        await expect(dialog).toBeHidden()

        await expect(rowOf(page, url)).toContainText('New post, Changelog published')
        const list = await json<{ data: Json[] }>(await api.get('/api/v1/webhooks'), 200)
        expect(list.data.find((w) => w.url === url)?.events).toEqual([
          'post.created',
          'changelog.published',
        ])

        // The secret never appears again: the edit dialog only offers to rotate it.
        await openRowAction(page, url, 'Edit')
        await expect(page.getByRole('button', { name: 'Rotate secret' })).toBeVisible()
        await expect(page.getByText(/whsec_/)).toHaveCount(0)
      } finally {
        const list = await json<{ data: Json[] }>(await api.get('/api/v1/webhooks'), 200)
        for (const w of list.data.filter((x) => x.url === url)) {
          await api.delete(`/api/v1/webhooks/${w.id}`)
        }
        await api.dispose()
      }
    }
  )

  test(
    'API-W-19 the create dialog shows the server refusal for an http or private URL',
    { tag: '@nightly' },
    async ({ asPerson, marker }) => {
      const page = await asPerson('admin')
      await page.goto(WEBHOOKS_TAB)
      const dialog = await openNewWebhook(page)
      await dialog.getByRole('checkbox', { name: 'Subscribe to New Post Created events' }).click()
      for (const url of [
        sink.url(marker).replace('https://', 'http://'),
        `https://10.0.0.5/hook/${marker}`,
      ]) {
        await dialog.getByLabel('Endpoint URL').fill(url)
        await dialog.getByRole('button', { name: 'Create webhook' }).click()
        await expect(
          dialog.getByText('Invalid webhook URL: must be HTTPS and cannot target private networks')
        ).toBeVisible()
      }
      const rows = await supportDb()`SELECT id FROM webhooks WHERE url LIKE ${`%${marker}%`}`
      expect(rows).toHaveLength(0)
    }
  )

  test(
    'API-W-22 saving the edit dialog keeps a board filter set over REST',
    { tag: '@core' },
    async ({ asPerson, playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      const board = await newBoard(api, marker)
      const page = await asPerson('admin')
      try {
        await withHook(
          api,
          marker,
          ['post.created'],
          async (hook) => {
            await page.goto(WEBHOOKS_TAB)
            await openRowAction(page, hook.url as string, 'Edit')
            const dialog = page.getByRole('dialog')
            await dialog.getByRole('checkbox', { name: 'Subscribe to New Comment events' }).click()
            await dialog.getByRole('button', { name: 'Save changes' }).click()
            await expect(dialog).toBeHidden()
            await expect(rowOf(page, hook.url as string)).toContainText('New post, New comment')
            expect(await getHook(api, hook.id)).toMatchObject({
              events: ['post.created', 'comment.created'],
              boardIds: [board.id],
            })
          },
          [board.id]
        )
      } finally {
        await api.dispose()
      }
    }
  )

  test(
    "API-W-22 saving an unrelated edit keeps a failing webhook's failure count",
    {
      tag: '@core',
    },
    async ({ asPerson, playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      // Scoped to a board nobody posts on: a delivery of another test's post
      // would succeed and reset the counters this test asserts on.
      const board = await newBoard(api, marker)
      const page = await asPerson('admin')
      try {
        await withHook(
          api,
          marker,
          ['post.created'],
          async (hook) => {
            await setHookCounters(hook.id, { failureCount: 12, lastError: 'HTTP 500' })
            await page.goto(WEBHOOKS_TAB)
            await openRowAction(page, hook.url as string, 'Edit')
            const dialog = page.getByRole('dialog')
            await dialog.getByRole('checkbox', { name: 'Subscribe to New Comment events' }).click()
            await dialog.getByRole('button', { name: 'Save changes' }).click()
            await expect(dialog).toBeHidden()
            await expect
              .poll(async () => (await getHook(api, hook.id)).events)
              .toEqual(['post.created', 'comment.created'])
            expect(await getHook(api, hook.id)).toMatchObject({
              failureCount: 12,
              lastError: 'HTTP 500',
            })
          },
          [board.id]
        )
      } finally {
        await api.dispose()
      }
    }
  )

  test(
    'API-W-23 an auto-disabled webhook is shown as such and turning it back on resumes deliveries',
    { tag: '@core' },
    async ({ asPerson, playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      const board = await newBoard(api, marker)
      const page = await asPerson('admin')
      try {
        await withHook(
          api,
          marker,
          ['post.created'],
          async (hook) => {
            const url = hook.url as string
            await json(
              await api.patch(`/api/v1/webhooks/${hook.id}`, { data: { status: 'disabled' } }),
              200
            )
            await setHookCounters(hook.id, { failureCount: 50, lastError: 'HTTP 500' })
            await page.goto(WEBHOOKS_TAB)
            const row = rowOf(page, url)
            await expect(row).toContainText('Error')
            await expect(row).toContainText('Auto-disabled after 50 failures · Error: HTTP 500')

            await openRowAction(page, url, 'Edit')
            const dialog = page.getByRole('dialog')
            await expect(dialog.getByText('Auto-disabled after 50 failures')).toBeVisible()
            await expect(dialog.getByText('Last error: HTTP 500')).toBeVisible()
            await expect(dialog.getByText('Turning this on resets the failure count')).toBeVisible()
            await dialog.getByRole('switch').click()
            await dialog.getByRole('button', { name: 'Save changes' }).click()
            await expect(dialog).toBeHidden()

            await expect(row).not.toContainText('Auto-disabled')
            await expect(row).toContainText('New post')
            expect(await getHook(api, hook.id)).toMatchObject({
              status: 'active',
              failureCount: 0,
              lastError: null,
            })
            const post = await newPost(api, board.id, `Back on ${marker}`)
            await delivered(marker, 'post.created', post.id)
          },
          [board.id]
        )
      } finally {
        await api.dispose()
      }
    }
  )

  test(
    'API-W-24 the list shows failure badges and notes',
    { tag: '@nightly' },
    async ({ asPerson, playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      const page = await asPerson('admin')
      try {
        await withHooks(
          api,
          [
            { channel: `${marker}-a`, events: ['post.created'] },
            { channel: `${marker}-b`, events: ['post.created'] },
            { channel: `${marker}-c`, events: ['post.voted'] },
            { channel: `${marker}-d`, events: ['post.created'] },
          ],
          async ([a, b, c, d]) => {
            await setHookCounters(a.id, { failureCount: 3, lastError: 'HTTP 500' })
            await setHookCounters(b.id, { failureCount: 25, lastError: 'HTTP 502' })
            await json(
              await api.patch(`/api/v1/webhooks/${c.id}`, { data: { status: 'disabled' } }),
              200
            )
            await setHookCounters(d.id, { failureCount: 1, lastError: 'HTTP 500' })
            await page.goto(WEBHOOKS_TAB)
            const ra = rowOf(page, a.url as string)
            await expect(ra).toContainText('Needs attention')
            await expect(ra).toContainText('3 consecutive failures · Error: HTTP 500')
            await expect(rowOf(page, d.url as string)).toContainText('1 consecutive failure ·')
            const rb = rowOf(page, b.url as string)
            await expect(rb).toContainText('Error')
            await expect(rb).toContainText('25 consecutive failures')
            const rc = rowOf(page, c.url as string)
            await expect(rc).toContainText('Off')
            await expect(rc).toContainText('post.voted')
            await expect(rc).not.toContainText('failure')
          }
        )
      } finally {
        await api.dispose()
      }
    }
  )

  test(
    'API-W-25 rotating the secret in the UI shows the new secret once and signs with it',
    { tag: '@core' },
    async ({ asPerson, playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      const board = await newBoard(api, marker)
      const page = await asPerson('admin')
      try {
        await withHook(
          api,
          marker,
          ['post.created'],
          async (hook) => {
            await page.goto(WEBHOOKS_TAB)
            await openRowAction(page, hook.url as string, 'Edit')
            await page.getByRole('button', { name: 'Rotate secret' }).click()
            const confirm = page.getByRole('dialog', { name: 'Rotate signing secret' })
            await expect(
              confirm.getByText('The old secret will stop working immediately')
            ).toBeVisible()
            await confirm.getByRole('button', { name: 'Rotate secret' }).click()
            await expect(confirm).toBeHidden()
            const edit = page.getByRole('dialog', { name: 'Edit webhook' })
            await expect(
              edit.getByText("Save this secret now. It won't be shown again.")
            ).toBeVisible()
            const secret = (await edit.getByText(/^whsec_/).textContent())?.trim() ?? ''
            expect(secret).toMatch(/^whsec_/)
            expect(secret).not.toBe(hook.secret)

            const post = await newPost(api, board.id, `UI rotated ${marker}`)
            const [d] = await delivered(marker, 'post.created', post.id)
            expectSigned(d, secret)
            expect(() => expectSigned(d, hook.secret)).toThrow()
          },
          [board.id]
        )
      } finally {
        await api.dispose()
      }
    }
  )

  test(
    'API-W-26 deleting a webhook in the UI removes it and stops deliveries',
    { tag: '@nightly' },
    async ({ asPerson, playwright, baseURL, people, marker }) => {
      const api = await adminApi(playwright, baseURL, people, marker)
      const board = await newBoard(api, marker)
      const control = `${marker}-ctl`
      const page = await asPerson('admin')
      const hook = await createHook(api, marker, ['post.created'], [board.id])
      try {
        await withHook(
          api,
          control,
          ['post.created'],
          async () => {
            const url = hook.url as string
            await page.goto(WEBHOOKS_TAB)
            await openRowAction(page, url, 'Delete')
            await expect(page.getByText('Delete webhook?')).toBeVisible()
            await expect(page.getByText('This action cannot be undone')).toBeVisible()
            await page.getByRole('button', { name: 'Delete webhook' }).click()
            await expect(rowOf(page, url)).toHaveCount(0)

            const post = await newPost(api, board.id, `After UI delete ${marker}`)
            await delivered(control, 'post.created', post.id)
            await expectNone(marker, is('post.created', post.id), 'deleted in the UI')
          },
          [board.id]
        )
      } finally {
        await api.delete(`/api/v1/webhooks/${hook.id}`)
        await api.dispose()
      }
    }
  )

  test(
    'API-W-27 the Webhooks tab follows webhook.view; Developers needs api_key.manage',
    { tag: '@core' },
    async ({ browser, newTeammate, marker }) => {
      // (a) Keys only: no Webhooks tab, and the URL falls back to Keys.
      const keysOnly = await newTeammate({
        roleKey: customRole(marker, 'keys', ['api_key.manage']),
      })
      const a = await keysOnly.newPage(browser)
      await a.goto(WEBHOOKS_TAB)
      await expect(a.getByRole('tab', { name: 'Keys' })).toHaveAttribute('aria-selected', 'true')
      await expect(a.getByRole('tab', { name: 'Webhooks' })).toHaveCount(0)

      // (b) Keys + webhook.view: sees the tab; the server refuses a create.
      const viewer = await newTeammate({
        roleKey: customRole(marker, 'view', ['api_key.manage', 'webhook.view']),
      })
      const b = await viewer.newPage(browser)
      await b.goto(WEBHOOKS_TAB)
      await expect(b.getByRole('tab', { name: 'Webhooks' })).toHaveAttribute(
        'aria-selected',
        'true'
      )
      const dialog = await openNewWebhook(b)
      await dialog.getByLabel('Endpoint URL').fill(sink.url(marker))
      await dialog.getByRole('checkbox', { name: 'Subscribe to New Post Created events' }).click()
      await dialog.getByRole('button', { name: 'Create webhook' }).click()
      await expect(dialog.getByText("You don't have permission to do that")).toBeVisible()
      const rows = await supportDb()`SELECT id FROM webhooks WHERE url = ${sink.url(marker)}`
      expect(rows).toHaveLength(0)

      // (c) Webhook permissions without api_key.manage: Developers is closed.
      const noKeys = await newTeammate({
        roleKey: customRole(marker, 'hooks', ['webhook.view', 'webhook.manage']),
      })
      const c = await noKeys.newPage(browser)
      await c.goto(WEBHOOKS_TAB)
      await expect(c).not.toHaveURL(/\/admin\/settings\/developers/)
      await expect(c.getByRole('tab', { name: 'Webhooks' })).toHaveCount(0)
    }
  )
})
