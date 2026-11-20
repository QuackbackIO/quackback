/**
 * Help center admin: deleting articles and categories, the Deleted items view
 * and restore.
 *
 * Journeys: HC-A-26, HC-A-27, HC-A-28.
 */
import type { Page } from '@playwright/test'
import { generateId } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { callServerFn, personApi } from '../../support/server-fns'
import { waitForHydration } from '../../utils/helpers'
import { articlePath, articleRow, hcApi, hcArticle, hcCategory } from '../../product/help-center'

/** Open a list row's menu (it shows on hover) and choose Delete. */
async function deleteFromRow(page: Page, title: string) {
  const heading = page.getByRole('heading', { name: title })
  await waitForHydration(heading)
  await heading.hover()
  const row = page.locator('div.group').filter({ has: heading })
  await row.getByRole('button').last().click()
  await page.getByRole('menuitem', { name: 'Delete' }).click()
}

/** A row of the Deleted items view, by the text it shows. */
function deletedRow(page: Page, name: string) {
  return page
    .locator('div')
    .filter({ hasText: name })
    .filter({ has: page.getByRole('button', { name: 'Restore' }) })
    .last()
}

test(
  'HC-A-26 deleting an article from the list soft-deletes it and takes it off the public site',
  { tag: '@core' },
  async ({ asPerson, marker, playwright, request }) => {
    const hc = await hcApi(playwright)
    const category = await hcCategory(hc, `Trash ${marker}`)
    const article = await hcArticle(hc, {
      categoryId: category.id,
      title: `Bin me ${marker}`,
      publish: true,
    })
    const keep = await hcArticle(hc, { categoryId: category.id, title: `Keep me ${marker}` })
    expect((await request.get(articlePath(article))).status()).toBe(200)

    const admin = await asPerson('admin')
    await admin.goto(`/admin/help-center?category=${category.id}`)
    await deleteFromRow(admin, article.title)
    const confirm = admin.getByRole('alertdialog')
    await confirm.getByRole('button', { name: 'Delete' }).click()
    await expect(confirm).toBeHidden()

    await expect(admin.getByRole('heading', { name: article.title })).toBeHidden()
    await expect(admin.getByRole('heading', { name: keep.title })).toBeVisible()
    const row = await articleRow(article.uuid)
    expect(row?.deleted_at).not.toBeNull()
    expect((await request.get(articlePath(article), { maxRedirects: 0 })).status()).toBe(404)

    // A second delete of the same id is refused.
    const api = await personApi(playwright, 'admin')
    const again = await callServerFn(api, 'deleteArticleFn', { id: article.id })
    expect(again.ok).toBe(false)
    expect(again.code).toBe('ARTICLE_NOT_FOUND')
  }
)

test(
  'HC-A-26 the delete dialogs say a deleted article or category can be restored',
  {
    tag: ['@core', '@quarantine'],
    annotation: {
      type: 'quarantine',
      description:
        'HC-B5: help-center-list.tsx says "permanently deleted" / "the UI provides no restore flow", but both are soft deletes restorable from Deleted items for 30 days',
    },
  },
  async ({ asPerson, marker, playwright }) => {
    const hc = await hcApi(playwright)
    const category = await hcCategory(hc, `Copy ${marker}`)
    const article = await hcArticle(hc, { categoryId: category.id, title: `Copy ${marker}` })
    const admin = await asPerson('admin')
    await admin.goto(`/admin/help-center?category=${category.id}`)

    await deleteFromRow(admin, article.title)
    const articleConfirm = admin.getByRole('alertdialog')
    await expect(articleConfirm).toBeVisible()
    await expect(articleConfirm).not.toContainText(/permanently|cannot be undone/i)
    await expect(articleConfirm).toContainText(/restore/i)
    await articleConfirm.getByRole('button', { name: 'Cancel' }).click()

    const treeRow = admin.getByRole('treeitem').filter({ hasText: category.name })
    await treeRow.hover()
    await treeRow.getByRole('button', { name: 'Delete category' }).click()
    const categoryConfirm = admin.getByRole('alertdialog')
    await expect(categoryConfirm).not.toContainText(/no restore flow|cannot be undone/i)
    await expect(categoryConfirm).toContainText(/Deleted items/i)
  }
)

test(
  'HC-A-27 Deleted items lists a deleted article and a deleted category with Restore',
  { tag: '@core' },
  async ({ asPerson, marker, playwright }) => {
    const hc = await hcApi(playwright)
    const gone = await hcCategory(hc, `Gone category ${marker}`)
    const home = await hcCategory(hc, `Home ${marker}`)
    const article = await hcArticle(hc, { categoryId: home.id, title: `Gone article ${marker}` })
    expect((await hc.delete(`/api/v1/help-center/articles/${article.id}`)).status()).toBe(204)
    expect((await hc.delete(`/api/v1/help-center/categories/${gone.id}`)).status()).toBe(204)

    const admin = await asPerson('admin')
    // Article performance is on; Deleted items replaces it (one view at a time).
    await admin.goto('/admin/help-center?performance=true')
    const deletedItems = admin.getByRole('option', { name: 'Deleted items' })
    await waitForHydration(deletedItems)
    await deletedItems.click()
    await expect(admin.getByRole('heading', { name: 'Deleted items', level: 1 })).toBeVisible()
    await expect(admin).toHaveURL(/deleted=true/)
    expect(admin.url()).not.toContain('performance=true')

    const categoryRow = deletedRow(admin, gone.name)
    await expect(categoryRow).toContainText(/Deleted .*ago|Deleted just now|Deleted now/i)
    const articleRowEl = deletedRow(admin, article.title)
    await expect(articleRowEl).toBeVisible()

    // Restore from the view brings the article back.
    await articleRowEl.getByRole('button', { name: 'Restore' }).click()
    await expect.poll(async () => (await articleRow(article.uuid))?.deleted_at).toBeNull()
    await expect(admin.getByText(article.title)).toBeHidden()
  }
)

test(
  'HC-A-28 restore brings an article back as it was, within 30 days only',
  { tag: '@core' },
  async ({ marker, playwright, request }) => {
    const hc = await hcApi(playwright)
    const category = await hcCategory(hc, `Restore ${marker}`)
    const live = await hcArticle(hc, {
      categoryId: category.id,
      title: `Comes back ${marker}`,
      publish: true,
    })
    const old = await hcArticle(hc, { categoryId: category.id, title: `Too old ${marker}` })
    const never = await hcArticle(hc, { categoryId: category.id, title: `Never deleted ${marker}` })
    for (const a of [live, old]) {
      expect((await hc.delete(`/api/v1/help-center/articles/${a.id}`)).status()).toBe(204)
    }
    await supportDb()`UPDATE kb_articles SET deleted_at = NOW() - interval '31 days'
      WHERE id = ${old.uuid}`

    const api = await personApi(playwright, 'admin')
    const restored = await callServerFn<{ publishedAt: string | null }>(api, 'restoreArticleFn', {
      id: live.id,
    })
    expect(restored.ok, restored.error).toBe(true)
    expect(restored.data.publishedAt).not.toBeNull()
    expect((await articleRow(live.uuid))?.deleted_at).toBeNull()
    // Published before, so public again at once.
    expect((await request.get(articlePath(live))).status()).toBe(200)

    const expired = await callServerFn(api, 'restoreArticleFn', { id: old.id })
    expect(expired.code).toBe('RESTORE_EXPIRED')
    expect(expired.error).toContain('Articles can only be restored within 30 days of deletion')
    expect((await articleRow(old.uuid))?.deleted_at).not.toBeNull()

    const notDeleted = await callServerFn(api, 'restoreArticleFn', { id: never.id })
    expect(notDeleted.code).toBe('VALIDATION_ERROR')
    expect(notDeleted.error).toContain('Article is not deleted')

    const unknown = await callServerFn(api, 'restoreArticleFn', { id: generateId('article') })
    expect(unknown.code).toBe('ARTICLE_NOT_FOUND')
  }
)
