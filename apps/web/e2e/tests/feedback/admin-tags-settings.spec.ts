/**
 * Settings > Tags: the list, create and edit, delete, and the colour dot.
 *
 * Journeys: FBA-T-30 FBA-T-31 FBA-T-32 FBA-T-33
 */
import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { callServerFn, personApi } from '../../support/server-fns'
import { supportDb } from '../../support/db'
import { waitForHydration } from '../../utils/helpers'
import {
  inboxTitles,
  makeBoard,
  makePost,
  makeTag,
  openInbox,
  uuid,
} from '../../product/feedback-admin'
import { tagRowByName } from '../../product/feedback-admin-settings'

/** The innermost element holding a tag's whole row (dot, name, badges, meta, menu). */
function tagListRow(page: Page, name: string) {
  return page
    .locator('div')
    .filter({ has: page.getByRole('button', { name: `Actions for ${name}` }) })
    .filter({ has: page.getByRole('button', { name: `Change colour of ${name}` }) })
    .last()
}

/** A tag name unique to the test that fits the 50-character limit. */
function tagName(marker: string, label: string): string {
  return `${label} ${marker.slice(-14)}`
}

test(
  'FBA-T-30 tags are listed alphabetically with a colour dot, description and Internal badge',
  { tag: '@core' },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const beta = await makeTag(api, tagName(marker, 'zz beta'), { description: `About ${marker}` })
    const alpha = await makeTag(api, tagName(marker, 'zz alpha'), { isPublic: false })
    await api.dispose()

    const admin = await asPerson('admin')
    await admin.goto('/admin/settings/tags')
    await waitForHydration(admin.getByRole('button', { name: 'New tag' }))
    const dots = await admin
      .getByRole('button', { name: /^Change colour of / })
      .evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')))
    const ia = dots.indexOf(`Change colour of ${alpha.name}`)
    const ib = dots.indexOf(`Change colour of ${beta.name}`)
    expect(ia).toBeGreaterThanOrEqual(0)
    expect(ib).toBeGreaterThan(ia)

    const alphaRow = tagListRow(admin, alpha.name)
    await expect(alphaRow).toContainText('Internal')
    const betaRow = tagListRow(admin, beta.name)
    await expect(betaRow).toContainText(`About ${marker}`)
    await expect(betaRow).not.toContainText('Internal')
  }
)

test(
  'FBA-T-31 New tag creates an internal tag; renaming to another tag name in a different case is refused',
  { tag: '@core' },
  async ({ playwright, asPerson, marker }) => {
    const name = tagName(marker, 'Billing')
    const api = await personApi(playwright, 'admin')
    const other = await makeTag(api, tagName(marker, 'Exports'))
    await api.dispose()

    const admin = await asPerson('admin')
    await admin.goto('/admin/settings/tags')
    await waitForHydration(admin.getByRole('button', { name: 'New tag' }))
    const dialog = admin.getByRole('dialog')
    await expect(async () => {
      await admin.getByRole('button', { name: 'New tag' }).click()
      await expect(dialog.getByText('New tag')).toBeVisible({ timeout: 2000 })
    }).toPass({ timeout: 15_000 })
    await dialog.getByLabel('Name').fill(name)
    await dialog.getByRole('radio', { name: 'Internal' }).click()
    await dialog.getByPlaceholder('When to use this tag').fill(`Money ${marker}`)
    await dialog.getByRole('button', { name: 'Create tag' }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(async () => (await tagRowByName(name))?.is_public).toBe(false)
    const row = await tagRowByName(name)
    expect(row?.description).toBe(`Money ${marker}`)
    expect(String(row?.color)).toMatch(/^#[0-9a-f]{6}$/i)

    // Rename it to the other tag's name in upper case: refused inline.
    await expect(async () => {
      await admin.keyboard.press('Escape')
      await admin.getByRole('button', { name: `Actions for ${name}` }).click()
      await admin.getByRole('menuitem', { name: 'Edit' }).click({ timeout: 2000 })
    }).toPass({ timeout: 15_000 })
    await expect(dialog.getByText('Edit tag')).toBeVisible()
    await dialog.getByLabel('Name').fill(other.name.toUpperCase())
    await dialog.getByRole('button', { name: 'Save changes' }).click()
    await expect(dialog.getByText(/already exists/)).toBeVisible()
    expect((await tagRowByName(name))?.name).toBe(name)

    // A plain rename saves.
    const renamed = tagName(marker, 'Invoices')
    await dialog.getByLabel('Name').fill(renamed)
    await dialog.getByRole('button', { name: 'Save changes' }).click()
    await expect(dialog).toBeHidden()
    await expect
      .poll(async () => String((await tagRowByName(renamed))?.id ?? ''))
      .toBe(String(row?.id))
  }
)

test(
  'FBA-T-31 a tag can be created with the name of a deleted tag',
  {
    tag: ['@core', '@quarantine'],
    annotation: {
      type: 'quarantine',
      description:
        'FBA-T-31: createPostTag checks the name against soft-deleted tags too (post-tag.service.ts:53), so a deleted tag blocks its name for ever',
    },
  },
  async ({ playwright, marker }) => {
    const api = await personApi(playwright, 'admin')
    const name = tagName(marker, 'Phoenix')
    const tag = await makeTag(api, name)
    const del = await callServerFn(api, 'deletePostTagFn', { id: tag.id })
    expect(del.ok, del.raw).toBe(true)
    const again = await callServerFn(api, 'createPostTagFn', { name, color: '#6b7280' })
    expect(again.code).not.toBe('DUPLICATE_NAME')
    expect(again.ok, again.raw).toBe(true)
    await api.dispose()
  }
)

test(
  'FBA-T-32 deleting a tag asks first, removes it from the page and cannot be repeated',
  { tag: '@core' },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const tag = await makeTag(api, tagName(marker, 'Legacy'))

    const admin = await asPerson('admin')
    await admin.goto('/admin/settings/tags')
    await waitForHydration(admin.getByRole('button', { name: 'New tag' }))
    await expect(async () => {
      await admin.keyboard.press('Escape')
      await admin.getByRole('button', { name: `Actions for ${tag.name}` }).click()
      await admin.getByRole('menuitem', { name: 'Delete' }).click({ timeout: 2000 })
    }).toPass({ timeout: 15_000 })
    const confirm = admin.getByRole('alertdialog').or(admin.getByRole('dialog'))
    await expect(confirm.getByText('Delete tag?')).toBeVisible()
    await expect(
      confirm.getByText(`"${tag.name}" will be removed from all posts. This cannot be undone.`)
    ).toBeVisible()
    await confirm.getByRole('button', { name: 'Delete tag' }).click()
    await expect(admin.getByRole('button', { name: `Actions for ${tag.name}` })).toHaveCount(0)
    await expect.poll(async () => (await tagRowByName(tag.name))?.deleted_at ?? null).not.toBeNull()

    const again = await callServerFn(api, 'deletePostTagFn', { id: tag.id })
    expect(again.ok).toBe(false)
    expect(again.code).toBe('TAG_NOT_FOUND')
    await api.dispose()
  }
)

test(
  'FBA-T-32 a deleted tag no longer shows on the posts it was on',
  {
    tag: ['@core', '@quarantine'],
    annotation: {
      type: 'quarantine',
      description:
        'FBA-T-32: deletePostTag only sets deleted_at (post-tag.service.ts:148); post_tag_assignments stay and the inbox tags relation has no deleted_at filter (post.inbox.ts), so the chip stays on the post',
    },
  },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const tag = await makeTag(api, tagName(marker, 'Gone'))
    const keep = await makeTag(api, tagName(marker, 'Kept'))
    const board = await makeBoard(api, marker)
    const post = await makePost(api, {
      boardId: board.id,
      title: `${marker} tagged`,
      tagIds: [tag.id, keep.id],
    })
    const [{ n }] = await supportDb()`SELECT count(*)::int AS n FROM post_tag_assignments
                                       WHERE post_id = ${uuid(post.id)}`
    expect(n).toBe(2)

    const admin = await asPerson('admin')
    await openInbox(admin, { board: [board.id] })
    await expect.poll(() => inboxTitles(admin, marker)).toEqual([post.title])
    const row = admin.locator('div', { has: admin.locator('h3', { hasText: post.title }) }).last()
    await expect(row.getByText(tag.name)).toBeVisible()

    const del = await callServerFn(api, 'deletePostTagFn', { id: tag.id })
    expect(del.ok, del.raw).toBe(true)
    await admin.reload()
    await expect(row.getByText(keep.name)).toBeVisible()
    await expect(row.getByText(tag.name)).toHaveCount(0)
    await api.dispose()
  }
)

test(
  'FBA-T-33 choosing a colour from the row dot autosaves the tag colour',
  { tag: '@nightly' },
  async ({ playwright, asPerson, marker }) => {
    const api = await personApi(playwright, 'admin')
    const tag = await makeTag(api, tagName(marker, 'Paint'))
    await api.dispose()

    const admin = await asPerson('admin')
    await admin.goto('/admin/settings/tags')
    await waitForHydration(admin.getByRole('button', { name: 'New tag' }))
    const hex = admin.getByRole('textbox').last()
    await expect(async () => {
      await admin.keyboard.press('Escape')
      await admin.getByRole('button', { name: `Change colour of ${tag.name}` }).click()
      await expect(hex).toBeVisible({ timeout: 2000 })
    }).toPass({ timeout: 15_000 })
    await hex.fill('#abcdef')
    await hex.press('Enter')
    await expect.poll(async () => (await tagRowByName(tag.name))?.color).toBe('#abcdef')
  }
)
