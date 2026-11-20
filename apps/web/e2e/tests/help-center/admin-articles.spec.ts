/**
 * Help center admin: writing and editing articles in the create dialog and the
 * editor modal.
 *
 * Journeys: HC-A-04, HC-A-05, HC-A-06, HC-A-08, HC-A-13, HC-A-15, HC-A-17,
 * HC-A-19, HC-A-20.
 */
import type { Page } from '@playwright/test'
import { generateId } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { waitForHydration } from '../../utils/helpers'
import {
  articlePath,
  articleRow,
  editorPath,
  hcApi,
  hcArticle,
  hcCategory,
  uuidOfTypeId,
} from '../../product/help-center'

/**
 * The editor modal over the list (/admin/help-center?article=<id>). Found by
 * its header's Copy Link, which stays put while a save is pending (the Save
 * changes label turns into "Saving…").
 */
function editorModal(page: Page) {
  return page.getByRole('dialog').filter({ has: page.getByRole('button', { name: 'Copy Link' }) })
}

/** Open the create dialog from the list's New article button. */
async function openCreateDialog(page: Page) {
  await page.goto('/admin/help-center')
  const button = page.getByRole('button', { name: 'New article' }).first()
  await waitForHydration(button)
  await button.click()
  const dialog = page.getByRole('dialog', { name: 'Create help article' })
  await expect(dialog.getByPlaceholder('Article title')).toBeVisible()
  return dialog
}

/** Type into the dialog's rich text body. */
async function typeBody(page: Page, scope: ReturnType<Page['getByRole']>, text: string) {
  await scope.locator('.ProseMirror[contenteditable="true"]').click()
  await page.keyboard.type(text)
}

/** The article id the URL's ?article= names, once it is there. */
async function articleIdInUrl(page: Page): Promise<string> {
  await expect(page).toHaveURL(/[?&]article=article_/, { timeout: 15_000 })
  return new URL(page.url()).searchParams.get('article')!
}

test.describe('creating articles', () => {
  test(
    'HC-A-04 a draft saved with no category is filed under General and opens in the editor',
    { tag: '@smoke' },
    async ({ asPerson, people, marker, request }) => {
      const admin = await asPerson('admin')
      const dialog = await openCreateDialog(admin)
      const title = `Draft ${marker}`
      await dialog.getByPlaceholder('Article title').fill(title)
      await typeBody(admin, dialog, `First words of ${marker}`)
      await dialog.getByRole('button', { name: 'Save draft' }).click()

      const id = await articleIdInUrl(admin)
      await expect(editorModal(admin).getByPlaceholder('Article title')).toHaveValue(title)

      const row = await articleRow(uuidOfTypeId(id))
      expect(row?.title).toBe(title)
      expect(row?.published_at).toBeNull()
      expect(String(row?.content)).toContain(`First words of ${marker}`)
      expect(row?.principal_id).toBe(uuidOfTypeId(people.people.admin.principalId))
      const [category] = await supportDb()`SELECT slug, deleted_at FROM kb_categories
        WHERE id = ${row?.category_id as string}`
      expect(category.slug).toMatch(/^general(-\d+)?$/)
      expect(category.deleted_at).toBeNull()

      // A draft is not on the public site.
      const [{ url_id: urlId, slug }] = await supportDb()`SELECT url_id, slug FROM kb_articles
        WHERE id = ${uuidOfTypeId(id)}`
      expect((await request.get(articlePath({ urlId, slug }), { maxRedirects: 0 })).status()).toBe(
        404
      )
    }
  )

  test(
    'HC-A-05 the create dialog refuses an empty title or an empty body and saves nothing',
    { tag: '@core' },
    async ({ asPerson, marker }) => {
      const admin = await asPerson('admin')
      const dialog = await openCreateDialog(admin)
      const save = dialog.getByRole('button', { name: 'Save draft' })

      await save.click()
      await expect(dialog.getByText('Title is required')).toBeVisible()

      await dialog.getByPlaceholder('Article title').fill(`Title only ${marker}`)
      await save.click()
      await expect(dialog.getByText('Content is required')).toBeVisible()
      await expect(dialog.getByText('Title is required')).toBeHidden()

      await dialog.getByPlaceholder('Article title').fill('')
      await typeBody(admin, dialog, `Body only ${marker}`)
      await save.click()
      await expect(dialog.getByText('Title is required')).toBeVisible()

      // The dialog stays open and no row was written.
      await expect(dialog).toBeVisible()
      expect(admin.url()).not.toContain('article=')
      const rows = await supportDb()`SELECT id FROM kb_articles
        WHERE title LIKE ${`%${marker}%`} OR content LIKE ${`%${marker}%`}`
      expect(rows).toHaveLength(0)
    }
  )

  test(
    'HC-A-06 Publish creates the article live in one step',
    { tag: '@core' },
    async ({ asPerson, marker, request }) => {
      const admin = await asPerson('admin')
      const dialog = await openCreateDialog(admin)
      const title = `Published at once ${marker}`
      await dialog.getByPlaceholder('Article title').fill(title)
      await typeBody(admin, dialog, `Live words ${marker}`)
      // Publish is the main action, with Save draft beside it.
      await expect(dialog.getByRole('button', { name: 'Save draft' })).toBeVisible()
      await dialog.getByRole('button', { name: 'Publish', exact: true }).click()

      const id = await articleIdInUrl(admin)
      const modal = editorModal(admin)
      await expect(modal.getByPlaceholder('Article title')).toHaveValue(title)
      await expect(modal.getByRole('button', { name: 'Published', exact: true })).toBeVisible()

      const row = await articleRow(uuidOfTypeId(id))
      expect(row?.published_at).not.toBeNull()
      const res = await request.get(
        articlePath({ urlId: row!.url_id as number, slug: row!.slug as string })
      )
      expect(res.status()).toBe(200)
      expect(await res.text()).toContain(title)
    }
  )

  test(
    'HC-A-08 an article is filed under a picked category, or one created from the sidebar',
    { tag: '@core' },
    async ({ asPerson, marker, playwright }) => {
      const hc = await hcApi(playwright)
      const existing = await hcCategory(hc, `Picked ${marker}`)
      const admin = await asPerson('admin')

      // 1. Pick an existing category.
      let dialog = await openCreateDialog(admin)
      await dialog.getByPlaceholder('Article title').fill(`In picked ${marker}`)
      await typeBody(admin, dialog, 'Body')
      await dialog.getByRole('combobox').click()
      await admin.getByRole('option', { name: existing.name }).click()
      await dialog.getByRole('button', { name: 'Save draft' }).click()
      const first = await articleIdInUrl(admin)
      expect((await articleRow(uuidOfTypeId(first)))?.category_id).toBe(existing.uuid)

      // 2. Create a category from the plus button; it is selected for the article.
      dialog = await openCreateDialog(admin)
      await dialog.getByPlaceholder('Article title').fill(`In new ${marker}`)
      await typeBody(admin, dialog, 'Body')
      await dialog.getByTitle('Create new category').click()
      const newCategory = admin.getByRole('dialog', { name: 'New category' })
      const name = `Made inline ${marker}`
      await newCategory.getByLabel('Name').fill(name)
      await newCategory.getByRole('button', { name: 'Create' }).click()
      await expect(newCategory).toBeHidden()
      await dialog.getByRole('button', { name: 'Save draft' }).click()
      const second = await articleIdInUrl(admin)
      const row = await articleRow(uuidOfTypeId(second))
      const [category] =
        await supportDb()`SELECT name FROM kb_categories WHERE id = ${row?.category_id as string}`
      expect(category.name).toBe(name)
    }
  )
})

test.describe('editing articles', () => {
  test(
    'HC-A-13 the editor opens from a row or a deep link and saves title, description, body and category',
    { tag: '@core' },
    async ({ asPerson, marker, playwright }) => {
      const hc = await hcApi(playwright)
      const from = await hcCategory(hc, `From ${marker}`)
      const to = await hcCategory(hc, `To ${marker}`)
      const article = await hcArticle(hc, {
        categoryId: from.id,
        title: `Before ${marker}`,
        content: 'Old body text.',
      })
      const admin = await asPerson('admin')

      // From the list row (the list filtered to the article's category).
      await admin.goto(`/admin/help-center?category=${from.id}`)
      const modal = editorModal(admin)
      // The list is server-rendered: a click before hydration does nothing.
      await expect(async () => {
        await admin.getByRole('heading', { name: article.title }).click()
        await expect(modal.getByPlaceholder('Article title')).toHaveValue(article.title, {
          timeout: 2_000,
        })
      }).toPass({ timeout: 15_000 })
      await expect(admin).toHaveURL(new RegExp(`article=${article.id}`))
      // Nothing changed yet: nothing to save. Cancel closes without saving.
      await expect(modal.getByRole('button', { name: 'Save changes' })).toBeDisabled()
      await modal.getByRole('button', { name: 'Cancel' }).click()
      await expect(modal).toBeHidden()

      // From a deep link.
      await admin.goto(editorPath(article))
      await expect(modal.getByPlaceholder('Article title')).toHaveValue(article.title)
      const before = await articleRow(article.uuid)
      const newTitle = `After ${marker}`
      await modal.getByPlaceholder('Article title').fill(`  ${newTitle}  `)
      await modal.getByLabel('Page description').fill(`  Summary ${marker}  `)
      await modal.locator('.ProseMirror[contenteditable="true"]').click()
      await admin.keyboard.press('ControlOrMeta+a')
      await admin.keyboard.type(`New body ${marker}`)
      await modal.getByRole('combobox').first().click()
      await admin.getByRole('option', { name: to.name }).click()
      await modal.getByRole('button', { name: 'Save changes' }).click()
      await expect(modal).toBeHidden()

      const row = await articleRow(article.uuid)
      expect(row?.title).toBe(newTitle)
      expect(row?.description).toBe(`Summary ${marker}`)
      expect(String(row?.content)).toContain(`New body ${marker}`)
      expect(String(row?.content)).not.toContain('Old body text')
      expect(row?.category_id).toBe(to.uuid)
      expect((row?.updated_at as Date).getTime()).toBeGreaterThan(
        (before?.updated_at as Date).getTime()
      )

      // The list row shows the new title and the description preview.
      await admin.goto(`/admin/help-center?category=${to.id}`)
      await expect(admin.getByRole('heading', { name: newTitle })).toBeVisible()
      await expect(admin.getByText(`Summary ${marker}`)).toBeVisible()
    }
  )

  test(
    'HC-A-15 emptying the description in the editor clears it',
    {
      tag: ['@core', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'HC-B12: article-modal.tsx sends description undefined for an empty field, which updateArticle reads as unchanged',
      },
    },
    async ({ asPerson, marker, playwright }) => {
      const hc = await hcApi(playwright)
      const category = await hcCategory(hc, `Desc ${marker}`)
      const article = await hcArticle(hc, {
        categoryId: category.id,
        title: `Described ${marker}`,
        description: `Old summary ${marker}`,
      })
      const admin = await asPerson('admin')
      await admin.goto(editorPath(article))
      const modal = editorModal(admin)
      const description = modal.getByLabel('Page description')
      await expect(description).toHaveValue(`Old summary ${marker}`)
      await description.fill('')
      await modal.getByRole('button', { name: 'Save changes' }).click()
      await expect(modal).toBeHidden()

      await expect.poll(async () => (await articleRow(article.uuid))?.description).toBeNull()
      await admin.goto(editorPath(article))
      await expect(modal.getByLabel('Page description')).toHaveValue('')
    }
  )

  test(
    'HC-A-17 the status button publishes and unpublishes the article',
    { tag: '@smoke' },
    async ({ asPerson, marker, playwright, request }) => {
      const hc = await hcApi(playwright)
      const category = await hcCategory(hc, `Toggle ${marker}`)
      const article = await hcArticle(hc, { categoryId: category.id, title: `Toggled ${marker}` })
      const admin = await asPerson('admin')
      await admin.goto(editorPath(article))
      const modal = editorModal(admin)
      await expect(modal.getByRole('button', { name: 'View', exact: true })).toBeHidden()

      await modal.getByRole('button', { name: 'Draft', exact: true }).click()
      await expect(modal.getByRole('button', { name: 'Published', exact: true })).toBeVisible()
      await expect(modal.getByRole('button', { name: 'View', exact: true })).toBeVisible()
      expect((await articleRow(article.uuid))?.published_at).not.toBeNull()
      const live = await request.get(articlePath(article))
      expect(live.status()).toBe(200)
      expect(await live.text()).toContain(article.title)

      await modal.getByRole('button', { name: 'Published', exact: true }).click()
      await expect(modal.getByRole('button', { name: 'Draft', exact: true })).toBeVisible()
      await expect(modal.getByRole('button', { name: 'View', exact: true })).toBeHidden()
      const row = await articleRow(article.uuid)
      expect(row?.published_at).toBeNull()
      expect(row?.deleted_at).toBeNull()
      expect((await request.get(articlePath(article), { maxRedirects: 0 })).status()).toBe(404)
    }
  )

  test(
    'HC-A-19 View in the editor opens the public article',
    { tag: '@nightly' },
    async ({ asPerson, marker, playwright }) => {
      const hc = await hcApi(playwright)
      const category = await hcCategory(hc, `View ${marker}`)
      const article = await hcArticle(hc, {
        categoryId: category.id,
        title: `Viewed ${marker}`,
        publish: true,
      })
      const admin = await asPerson('admin')
      await admin.goto(editorPath(article))
      const modal = editorModal(admin)
      const [tab] = await Promise.all([
        admin.context().waitForEvent('page'),
        modal.getByRole('button', { name: 'View', exact: true }).click(),
      ])
      await tab.waitForLoadState()
      expect(new URL(tab.url()).pathname).toBe(articlePath(article))
      await expect(tab.getByRole('heading', { level: 1, name: article.title })).toBeVisible()
    }
  )

  test(
    'HC-A-20 an unknown article id in the URL says the article was not found',
    {
      tag: ['@nightly', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'HC-B18: use-url-modal.ts opens the dialog for any ?article= value and article-modal.tsx waits for the article forever (spinner, no not-found state)',
      },
    },
    async ({ asPerson }) => {
      const admin = await asPerson('admin')
      await admin.goto(`/admin/help-center?article=${generateId('article')}`)
      const dialog = admin.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await expect(dialog.getByText(/not found|no longer exists|deleted/i)).toBeVisible({
        timeout: 10_000,
      })
      await expect(dialog.locator('.animate-spin')).toHaveCount(0)
    }
  )
})
