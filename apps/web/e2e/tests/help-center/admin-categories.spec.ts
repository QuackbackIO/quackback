/**
 * Help center admin: categories in the tree pane (create, edit, visibility,
 * segment gate, delete).
 *
 * Journeys: HC-A-31, HC-A-33, HC-A-34, HC-A-36.
 */
import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { waitForHydration } from '../../utils/helpers'
import {
  categoryRow,
  collectionPath,
  articleRow,
  gateToSegments,
  hcApi,
  hcArticle,
  hcCategory,
  hcSegment,
} from '../../product/help-center'

/** The tree row of a category. */
function treeRow(page: Page, name: string) {
  return page.getByRole('treeitem').filter({ hasText: name })
}

/** Hover a tree row and press one of its actions. */
async function rowAction(page: Page, name: string, action: string) {
  const row = treeRow(page, name)
  await waitForHydration(row.getByRole('button').first())
  await row.hover()
  await row.getByRole('button', { name: action }).click()
}

test(
  'HC-A-31 a new top-level category is stored trimmed with its icon and shows in the tree',
  { tag: '@core' },
  async ({ asPerson, marker, request }) => {
    const admin = await asPerson('admin')
    await admin.goto('/admin/help-center')
    const add = admin.getByRole('button', { name: 'New category' })
    await waitForHydration(add)
    await add.click()
    const dialog = admin.getByRole('dialog', { name: 'New category' })
    const create = dialog.getByRole('button', { name: 'Create' })
    await expect(create).toBeDisabled()
    await dialog.getByLabel('Name').fill('   ')
    await expect(create).toBeDisabled()

    const name = `Getting started ${marker}`
    await dialog.getByLabel('Name').fill(`  ${name}  `)
    await dialog.getByLabel('Description').fill(`  Where to begin ${marker}  `)
    // The icon picker is the button beside the name.
    await dialog.locator('#category-name').locator('xpath=preceding-sibling::*[1]').click()
    await admin.getByPlaceholder('Search icons…').fill('rocket')
    await admin
      .getByTitle(/^rocket/)
      .first()
      .click()
    await create.click()
    await expect(dialog).toBeHidden()

    await expect(treeRow(admin, name)).toBeVisible()
    await expect(treeRow(admin, name).getByTitle('0 articles')).toBeVisible()
    const [row] = await supportDb()`SELECT * FROM kb_categories WHERE name = ${name}`
    expect(row).toMatchObject({
      name,
      description: `Where to begin ${marker}`,
      is_public: true,
      position: 0,
      parent_id: null,
      deleted_at: null,
    })
    expect(row.slug).toBe(`getting-started-${marker}`)
    expect(row.icon).toMatch(/^Rocket/)

    // No published article in it yet, so the public landing leaves it out.
    expect(await (await request.get('/hc')).text()).not.toContain(name)
  }
)

test(
  'HC-A-33 editing a category renames and re-parents it; its public URL keeps working',
  { tag: '@core' },
  async ({ asPerson, marker, playwright, request }) => {
    const hc = await hcApi(playwright)
    const parent = await hcCategory(hc, `New parent ${marker}`)
    const category = await hcCategory(hc, `Old name ${marker}`)
    await hcArticle(hc, { categoryId: category.id, title: `Inside ${marker}`, publish: true })
    const before = await categoryRow(category.uuid)

    const admin = await asPerson('admin')
    await admin.goto(`/admin/help-center?category=${category.id}`)
    await rowAction(admin, category.name, 'Edit category')
    const dialog = admin.getByRole('dialog', { name: 'Edit category' })
    await expect(dialog.getByLabel('Name')).toHaveValue(category.name)
    const name = `Renamed ${marker}`
    await dialog.getByLabel('Name').fill(name)
    await dialog.getByLabel('Description').fill(`Now described ${marker}`)
    await dialog.getByRole('combobox').click()
    await admin.getByRole('option', { name: parent.name }).click()
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()

    await expect.poll(async () => (await categoryRow(category.uuid))?.name).toBe(name)
    const row = await categoryRow(category.uuid)
    expect(row?.parent_id).toBe(parent.uuid)
    expect(row?.description).toBe(`Now described ${marker}`)
    expect((row?.updated_at as Date).getTime()).toBeGreaterThan(
      (before?.updated_at as Date).getTime()
    )
    // The tree nests the row under its new parent.
    await expect(treeRow(admin, name)).toHaveAttribute('aria-level', '2')

    // A rename keeps the slug; the public page shows the new name. Public
    // URLs are keyed by urlId, so a stale slug 301s to the canonical one.
    const page = await request.get(collectionPath(category))
    expect(page.status()).toBe(200)
    expect(await page.text()).toContain(name)
    const stale = await request.get(`/hc/en/collections/${category.urlId}-stale-slug`, {
      maxRedirects: 0,
    })
    expect(stale.status()).toBe(301)
    expect(new URL(stale.headers()['location'] ?? '', 'http://x').pathname).toBe(
      collectionPath(category)
    )
  }
)

test(
  'HC-A-34 making a gated category private clears its segment gate for good',
  { tag: '@core' },
  async ({ asPerson, marker, playwright, request }) => {
    const hc = await hcApi(playwright)
    const segment = await hcSegment(marker)
    const category = await hcCategory(hc, `Gated ${marker}`)
    await hcArticle(hc, { categoryId: category.id, title: `Gated doc ${marker}`, publish: true })
    await gateToSegments({ kind: 'category', uuid: category.uuid }, [segment.id])
    // Gated: a signed-out visitor gets the 404 a missing page gets.
    expect((await request.get(collectionPath(category), { maxRedirects: 0 })).status()).toBe(404)

    const admin = await asPerson('admin')
    await admin.goto(`/admin/help-center?category=${category.id}`)
    await rowAction(admin, category.name, 'Edit category')
    const dialog = admin.getByRole('dialog', { name: 'Edit category' })
    const gate = dialog.getByLabel('Category segment gate')
    await expect(gate).toBeVisible()
    await expect(gate).toContainText(segment.name)
    await dialog.getByRole('switch').click()
    await expect(gate).toBeHidden()
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()

    await expect.poll(async () => (await categoryRow(category.uuid))?.is_public).toBe(false)
    expect((await categoryRow(category.uuid))?.segment_ids).toEqual([])
    expect((await request.get(collectionPath(category), { maxRedirects: 0 })).status()).toBe(404)

    // Public again: the old restriction does not come back, so everyone sees it.
    await rowAction(admin, category.name, 'Edit category')
    await dialog.getByRole('switch').click()
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()
    await expect.poll(async () => (await categoryRow(category.uuid))?.is_public).toBe(true)
    expect((await categoryRow(category.uuid))?.segment_ids).toEqual([])
    expect((await request.get(collectionPath(category))).status()).toBe(200)
  }
)

test(
  'HC-A-36 deleting a category deletes its sub-categories and articles together',
  { tag: '@core' },
  async ({ asPerson, marker, playwright }) => {
    const hc = await hcApi(playwright)
    const root = await hcCategory(hc, `Root ${marker}`)
    const doomed = await hcCategory(hc, `Doomed ${marker}`, { parentId: root.id })
    const child = await hcCategory(hc, `Doomed child ${marker}`, { parentId: doomed.id })
    const a1 = await hcArticle(hc, { categoryId: doomed.id, title: `In doomed ${marker}` })
    const a2 = await hcArticle(hc, { categoryId: child.id, title: `In child ${marker}` })
    const survivor = await hcArticle(hc, { categoryId: root.id, title: `In root ${marker}` })

    const admin = await asPerson('admin')
    await admin.goto(`/admin/help-center?category=${doomed.id}`)
    await rowAction(admin, doomed.name, 'Delete category')
    const confirm = admin.getByRole('alertdialog')
    await expect(confirm).toContainText(`"${doomed.name}" along with 1 sub-category and 2 articles`)
    await confirm.getByRole('button', { name: 'Delete' }).click()
    await expect(confirm).toBeHidden()

    // The selection falls back to the parent.
    await expect(admin).toHaveURL(new RegExp(`category=${root.id}`))
    await expect(treeRow(admin, doomed.name)).toBeHidden()

    const rows = await Promise.all([
      categoryRow(doomed.uuid),
      categoryRow(child.uuid),
      articleRow(a1.uuid),
      articleRow(a2.uuid),
    ])
    const stamps = rows.map((r) => (r?.deleted_at as Date | null)?.getTime())
    expect(stamps.every((t) => typeof t === 'number')).toBe(true)
    expect(new Set(stamps).size).toBe(1)
    expect((await articleRow(survivor.uuid))?.deleted_at).toBeNull()
    expect((await categoryRow(root.uuid))?.deleted_at).toBeNull()
  }
)
