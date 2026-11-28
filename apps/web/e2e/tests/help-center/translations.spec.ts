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

/**
 * Open an article in the editor on its French tab. Returns the French tab and
 * the visible title and body fields (the other languages' forms stay mounted
 * so their unsaved edits survive a tab switch; the French one is the last).
 */
async function openFrench(admin: Page, article: HcArticle) {
  await admin.goto(editorPath(article))
  const bar = admin.getByRole('tablist', { name: 'Article languages' })
  const french = bar.getByRole('tab', { name: /Français/ })
  await waitForHydration(french)
  await french.click()
  return {
    french,
    title: () => admin.getByLabel('Article title').last(),
    body: () => admin.locator('[contenteditable="true"]').last(),
  }
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
    'HC-A-51 a missing language starts from the article text and saves as a draft',
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
        const fr = await openFrench(admin, article)
        await expect(fr.french).toHaveText('FrançaisNot translated')
        await expect(admin.getByText('This article is not in Français yet')).toBeVisible()
        await admin.getByRole('button', { name: 'Start from the English text' }).click()
        await expect(fr.title()).toHaveValue(article.title)
        await expect(admin.getByLabel('Page description').last()).toHaveValue(
          `Original summary ${marker}`
        )
        await expect(fr.body()).toContainText(`Original body ${marker}`)

        await fr.title().fill(`Traduit ${marker}`)
        await fr.body().click()
        await admin.keyboard.press('ControlOrMeta+a')
        await admin.keyboard.type(`Corps traduit ${marker}`)
        await admin.getByRole('button', { name: 'Save changes' }).click()
        await expect.poll(async () => (await translationRow(article, 'fr'))?.status).toBe('draft')
        const row = await translationRow(article, 'fr')
        expect(row?.title).toBe(`Traduit ${marker}`)
        expect(row?.content).toContain(`Corps traduit ${marker}`)
        await expect(fr.french).toHaveText('FrançaisDraft')
        // A draft translation is not public: the French page shows the
        // original, with a notice.
        const french = await visit(page, articlePath(article, 'fr'))
        expect(french.status).toBe(200)
        expect(french.text).toContain(`Original ${marker}`)
        expect(french.text).not.toContain(`Traduit ${marker}`)
        expect(french.text).toContain('hc-fallback-notice')
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
        const fr = await openFrench(admin, article)
        await admin.getByRole('button', { name: 'Start from the English text' }).click()
        await fr.title().fill(`Publié ${marker}`)
        await admin.getByRole('button', { name: 'Save changes' }).click()
        await expect.poll(async () => (await translationRow(article, 'fr'))?.status).toBe('draft')

        // The sidebar's status toggles the publish state of this language only.
        await admin.getByRole('button', { name: 'Draft', exact: true }).click()
        await expect
          .poll(async () => (await translationRow(article, 'fr'))?.status)
          .toBe('published')
        await expect(fr.french).toHaveText('FrançaisPublished')
        const live = await visit(page, articlePath(article, 'fr'))
        expect(live.status).toBe(200)
        expect(live.text).toContain(`Publié ${marker}`)

        await admin.getByRole('button', { name: 'Published', exact: true }).click()
        await expect.poll(async () => (await translationRow(article, 'fr'))?.status).toBe('draft')
        const unpublished = await visit(page, articlePath(article, 'fr'))
        expect(unpublished.status).toBe(200)
        expect(unpublished.text).not.toContain(`Publié ${marker}`)
        expect(unpublished.text).toContain('hc-fallback-notice')

        await admin.getByRole('button', { name: 'Delete translation' }).click()
        await expect.poll(async () => (await translationRow(article, 'fr')) ?? null).toBeNull()
        await expect(admin.getByText('This article is not in Français yet')).toBeVisible()
        await expect(fr.french).toHaveText('FrançaisNot translated')
      })
    }
  )

  test(
    'HC-A-53 saving a published translation keeps it published and updates the live page',
    { tag: '@core' },
    async ({ asPerson, marker, page, playwright }) => {
      const hc = await hcApi(playwright)
      const category = await hcCategory(hc, `Live ${marker}`)
      const article = await hcArticle(hc, {
        categoryId: category.id,
        title: `Live ${marker}`,
        publish: true,
      })
      await withSettings(FRENCH, async () => {
        await supportDb()`INSERT INTO kb_article_translations
            (id, article_id, locale, title, content, status, created_at, updated_at)
          VALUES (gen_random_uuid(), ${article.uuid}, 'fr', ${`En ligne ${marker}`}, 'Texte.',
            'published', NOW(), NOW())`
        const admin = await asPerson('admin')
        const fr = await openFrench(admin, article)
        await expect(fr.title()).toHaveValue(`En ligne ${marker}`)
        await fr.title().fill(`Corrigé ${marker}`)
        await admin.getByRole('button', { name: 'Save changes' }).click()
        await expect
          .poll(async () => (await translationRow(article, 'fr'))?.title)
          .toBe(`Corrigé ${marker}`)
        expect((await translationRow(article, 'fr'))?.status).toBe('published')
        const live = await visit(page, articlePath(article, 'fr'))
        expect(live.text).toContain(`Corrigé ${marker}`)
        expect(live.text).not.toContain(`En ligne ${marker}`)
      })
    }
  )
})
