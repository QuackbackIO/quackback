/**
 * Help center languages and article translations. The enabled language list
 * is workspace-wide (help_center_config.locales), so every test here is
 * `@isolated` and sets it with withSettings.
 *
 * Journeys: HC-A-48, HC-A-49, HC-A-51, HC-A-52, HC-A-53.
 */
import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { ISOLATED, ISOLATED_SKIP } from '../../support/automation'
import { supportDb } from '../../support/db'
import { withSettings } from '../../support/isolated-settings'
import { waitForHydration } from '../../utils/helpers'
import {
  articlePath,
  editorPath,
  hcApi,
  hcArticle,
  hcCategory,
  type HcArticle,
} from '../../product/help-center'

const FRENCH = {
  help_center_config: {
    'locales.additional': ['fr'],
    'locales.chrome.fr': {
      homepageTitle: 'Comment pouvons-nous aider ?',
      homepageDescription: '',
      searchPlaceholder: '',
    },
  },
}

/** What a signed-out visitor gets (a cookie skips the shared cache). */
async function visit(page: Page, path: string) {
  const res = await page.request.get(path, { maxRedirects: 0, headers: { cookie: 'e2e=1' } })
  return { status: res.status(), text: await res.text() }
}

async function translationRow(article: HcArticle, locale: string) {
  const [row] = await supportDb()`SELECT * FROM kb_article_translations
    WHERE article_id = ${article.uuid} AND locale = ${locale}`
  return row
}

/** Open an article's Translations dialog on French. */
async function openFrench(admin: Page, article: HcArticle) {
  await admin.goto(editorPath(article))
  const manage = admin.getByRole('button', { name: 'Manage' })
  await waitForHydration(manage)
  await manage.click()
  const dialog = admin.getByRole('dialog', { name: 'Translations' })
  await dialog.getByRole('combobox').click()
  await admin.getByRole('option', { name: 'Français' }).click()
  await expect(dialog.locator('#translation-title')).not.toHaveValue('')
  return dialog
}

test.describe('help center languages', { tag: '@isolated' }, () => {
  test.beforeEach(() => {
    test.skip(!ISOLATED, ISOLATED_SKIP)
  })

  test(
    'HC-A-48 adding a language stores it with default texts and opens /hc/<locale>',
    { tag: '@core' },
    async ({ asPerson, page }) => {
      await withSettings({ help_center_config: { 'locales.additional': [] } }, async () => {
        expect((await visit(page, '/hc/de')).status).toBe(404)
        const admin = await asPerson('admin')
        await admin.goto('/admin/settings/help-center?tab=domains-languages')
        const add = admin.getByRole('combobox').filter({ hasText: 'Add a language…' })
        await waitForHydration(add)
        await add.click()
        await admin.getByRole('option', { name: 'Deutsch' }).click()
        await admin.getByRole('button', { name: 'Add', exact: true }).click()
        await expect(admin.getByRole('button', { name: 'Remove Deutsch' })).toBeVisible()

        const [row] = await supportDb()`SELECT help_center_config FROM settings LIMIT 1`
        const locales = (
          JSON.parse(String(row.help_center_config)) as {
            locales: { additional: string[]; chrome: Record<string, unknown> }
          }
        ).locales
        expect(locales.additional).toEqual(['de'])
        expect(locales.chrome.de).toMatchObject({ homepageTitle: 'How can we help?' })
        expect((await visit(page, '/hc/de')).status).toBe(200)
      })
    }
  )

  test(
    'HC-A-49 removing a language takes its pages offline but keeps its translations',
    { tag: '@core' },
    async ({ asPerson, marker, page, playwright }) => {
      const hc = await hcApi(playwright)
      const category = await hcCategory(hc, `Langs ${marker}`)
      const article = await hcArticle(hc, {
        categoryId: category.id,
        title: `Language off ${marker}`,
        publish: true,
      })
      await withSettings(FRENCH, async () => {
        await supportDb()`INSERT INTO kb_article_translations
            (id, article_id, locale, title, content, status, created_at, updated_at)
          VALUES (gen_random_uuid(), ${article.uuid}, 'fr', ${`Langue ${marker}`}, 'Texte.',
            'published', NOW(), NOW())`
        const fr = articlePath(article, 'fr')
        expect((await visit(page, fr)).status).toBe(200)

        const admin = await asPerson('admin')
        await admin.goto('/admin/settings/help-center?tab=domains-languages')
        const remove = admin.getByRole('button', { name: 'Remove Français' })
        await waitForHydration(remove)
        await remove.click()
        await expect(remove).toBeHidden()

        expect((await visit(page, fr)).status).toBe(404)
        expect((await visit(page, '/hc/fr')).status).toBe(404)
        expect((await translationRow(article, 'fr'))?.title).toBe(`Langue ${marker}`)
      })
    }
  )

  test(
    'HC-A-51 a translation opens seeded with the article and saves as a draft',
    { tag: '@core' },
    async ({ asPerson, marker, page, playwright }) => {
      const hc = await hcApi(playwright)
      const category = await hcCategory(hc, `Translate ${marker}`)
      const article = await hcArticle(hc, {
        categoryId: category.id,
        title: `Original ${marker}`,
        description: `Original summary ${marker}`,
        content: `Original body ${marker}`,
        publish: true,
      })
      await withSettings(FRENCH, async () => {
        const admin = await asPerson('admin')
        const dialog = await openFrench(admin, article)
        await expect(dialog).toContainText('Untranslated')
        await expect(dialog.locator('#translation-title')).toHaveValue(article.title)
        await expect(dialog.locator('#translation-description')).toHaveValue(
          `Original summary ${marker}`
        )
        await expect(dialog.locator('#translation-content')).toHaveValue(
          new RegExp(`Original body ${marker}`)
        )

        await dialog.locator('#translation-title').fill(`Traduit ${marker}`)
        await dialog.locator('#translation-content').fill(`Corps traduit ${marker}`)
        await dialog.getByRole('button', { name: 'Save draft' }).click()
        await expect(dialog).toContainText('Draft')
        await expect.poll(async () => (await translationRow(article, 'fr'))?.status).toBe('draft')
        expect((await translationRow(article, 'fr'))?.title).toBe(`Traduit ${marker}`)
        // A draft translation is not public: the French URL is a 404.
        expect((await visit(page, articlePath(article, 'fr'))).status).toBe(404)
      })
    }
  )

  test(
    'HC-A-52 publish, unpublish and delete a translation',
    { tag: '@core' },
    async ({ asPerson, marker, page, playwright }) => {
      const hc = await hcApi(playwright)
      const category = await hcCategory(hc, `Publish fr ${marker}`)
      const article = await hcArticle(hc, {
        categoryId: category.id,
        title: `Base ${marker}`,
        publish: true,
      })
      await withSettings(FRENCH, async () => {
        const admin = await asPerson('admin')
        const dialog = await openFrench(admin, article)
        await dialog.locator('#translation-title').fill(`Publié ${marker}`)
        await dialog.getByRole('button', { name: 'Save draft' }).click()
        await expect.poll(async () => (await translationRow(article, 'fr'))?.status).toBe('draft')

        await dialog.getByRole('button', { name: 'Publish' }).click()
        await expect
          .poll(async () => (await translationRow(article, 'fr'))?.status)
          .toBe('published')
        const live = await visit(page, articlePath(article, 'fr'))
        expect(live.status).toBe(200)
        expect(live.text).toContain(`Publié ${marker}`)

        await dialog.getByRole('button', { name: 'Unpublish' }).click()
        await expect.poll(async () => (await translationRow(article, 'fr'))?.status).toBe('draft')
        expect((await visit(page, articlePath(article, 'fr'))).status).toBe(404)

        await dialog.getByRole('button', { name: 'Delete translation' }).click()
        await expect.poll(async () => (await translationRow(article, 'fr')) ?? null).toBeNull()
        await expect(dialog).toContainText('Untranslated')
      })
    }
  )

  test(
    'HC-A-53 Save draft on a published translation does not change the live page',
    {
      tag: ['@core', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'HC-B9: upsertArticleTranslation never touches status, so "Save draft" on a published translation publishes the edit at once',
      },
    },
    async ({ asPerson, marker, page, playwright }) => {
      const hc = await hcApi(playwright)
      const category = await hcCategory(hc, `Quirk ${marker}`)
      const article = await hcArticle(hc, {
        categoryId: category.id,
        title: `Quirk ${marker}`,
        publish: true,
      })
      await withSettings(FRENCH, async () => {
        await supportDb()`INSERT INTO kb_article_translations
            (id, article_id, locale, title, content, status, created_at, updated_at)
          VALUES (gen_random_uuid(), ${article.uuid}, 'fr', ${`En ligne ${marker}`}, 'Texte.',
            'published', NOW(), NOW())`
        const admin = await asPerson('admin')
        const dialog = await openFrench(admin, article)
        await expect(dialog.locator('#translation-title')).toHaveValue(`En ligne ${marker}`)
        await dialog.locator('#translation-title').fill(`Brouillon ${marker}`)
        await dialog.getByRole('button', { name: 'Save draft' }).click()
        await expect
          .poll(async () => {
            const row = await translationRow(article, 'fr')
            return row?.title === `Brouillon ${marker}` || row?.status === 'draft'
          })
          .toBe(true)
        const live = await visit(page, articlePath(article, 'fr'))
        expect(live.text).not.toContain(`Brouillon ${marker}`)
      })
    }
  )
})
