/**
 * Help center pages in another language (area CUS-HC-L): a translated article
 * shows its own body, a page whose address names a language reads in that
 * language, whatever the browser asks for, and an article or collection with
 * no version in the language still shows, in its own language, named.
 *
 * Set E2E_GALLERY_DIR to also save a screenshot of each result there.
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import { generateId, toUuid } from '@quackback/ids'
import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { ISOLATED } from '../../support/automation'
import { withSettings } from '../../support/isolated-settings'

async function snap(page: Page, name: string): Promise<void> {
  const dir = process.env.E2E_GALLERY_DIR
  if (!dir) return
  mkdirSync(dir, { recursive: true })
  await page.screenshot({ path: join(dir, `${name}.png`) })
}

function catalogue(locale: string): Record<string, string> {
  const here = dirname(fileURLToPath(import.meta.url))
  return JSON.parse(readFileSync(join(here, '../../../src/locales', `${locale}.json`), 'utf8'))
}

const MAIN_BODY = 'Open Settings, then Account.'

/**
 * A published main-language article with a rich body, and a published French
 * translation saved the way the editor's translation dialog saves it:
 * Markdown only, no rich body.
 */
async function seedTranslatedArticle(marker: string): Promise<{ path: string; frBody: string }> {
  const sql = supportDb()
  const categoryUuid = toUuid(generateId('kb_category'))
  const articleUuid = toUuid(generateId('article'))
  const [author] = await sql`SELECT id FROM principal WHERE role = 'admin' AND type = 'user'
    ORDER BY created_at LIMIT 1`
  const slug = `${marker}-${randomBytes(3).toString('hex')}`
  const doc = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: MAIN_BODY }] }],
  }
  await sql`INSERT INTO kb_categories (id, slug, name, is_public, position, created_at, updated_at)
    VALUES (${categoryUuid}, ${slug}, ${`Getting started ${marker}`}, true, 0, NOW(), NOW())`
  await sql`INSERT INTO kb_articles (id, category_id, slug, title, content, content_json,
      principal_id, published_at, created_at, updated_at)
    VALUES (${articleUuid}, ${categoryUuid}, ${slug}, ${`Set up your account ${marker}`},
      ${MAIN_BODY}, ${sql.json(doc)}, ${author.id}, NOW() - interval '1 minute', NOW(), NOW())`
  await sql`INSERT INTO kb_category_translations (id, category_id, locale, name)
    VALUES (${toUuid(generateId('kb_category_translation'))}, ${categoryUuid}, 'fr',
      ${`Premiers pas ${marker}`})`
  const frBody = 'Ouvrez Paramètres, puis Compte.'
  await sql`INSERT INTO kb_article_translations (id, article_id, locale, title, content,
      content_json, status)
    VALUES (${toUuid(generateId('kb_article_translation'))}, ${articleUuid}, 'fr',
      ${`Configurer votre compte ${marker}`}, ${`Ouvrez **Paramètres**, puis **Compte**.`},
      NULL, 'published')`
  const [{ url_id: urlId }] = await sql`SELECT url_id FROM kb_articles WHERE id = ${articleUuid}`
  return { path: `/hc/fr/articles/${urlId}-${slug}`, frBody }
}

test.describe('help center in another language', () => {
  test.skip(!ISOLATED, 'turns on workspace-wide help center languages; runs in support-isolated')

  test(
    'CUS-HC-L1 a French article saved without a rich body shows its own text, in a French page, for an English browser',
    { tag: ['@core', '@isolated'] },
    async ({ browser, marker }) => {
      const { path, frBody } = await seedTranslatedArticle(marker)
      const fr = catalogue('fr')
      await withSettings(
        {
          feature_flags: { helpCenter: true },
          help_center_config: { 'locales.additional': ['fr'] },
        },
        async () => {
          const context = await browser.newContext({
            locale: 'en-US',
            extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
          })
          const page = await context.newPage()
          try {
            await page.goto(path)
            const main = page.locator('main')
            await expect(main.getByText(`Configurer votre compte ${marker}`)).toBeVisible({
              timeout: 20_000,
            })
            // The translation's own body, with its formatting; never the main language's.
            await expect(main.getByText(frBody)).toBeVisible()
            await expect(main.locator('strong', { hasText: 'Paramètres' })).toBeVisible()
            await expect(main.getByText(MAIN_BODY)).toHaveCount(0)
            // The page's own words follow the address, not the browser.
            await expect(page.locator('html')).toHaveAttribute('lang', 'fr')
            await expect(
              page.getByText(fr['portal.hc.articleFeedback.question'], { exact: true })
            ).toBeVisible()
            await snap(page, 'hc-fr-article-english-browser')
          } finally {
            await context.close()
          }
        }
      )
    }
  )

  test(
    "CUS-HC-L2 a German main language: German articles under the visitor's own menus, German for everyone on request, and German search",
    { tag: ['@core', '@isolated'] },
    async ({ browser, request, marker }) => {
      const sql = supportDb()
      const categoryUuid = toUuid(generateId('kb_category'))
      const articleUuid = toUuid(generateId('article'))
      const [author] = await sql`SELECT id FROM principal WHERE role = 'admin' AND type = 'user'
        ORDER BY created_at LIMIT 1`
      const slug = `${marker}-${randomBytes(3).toString('hex')}`
      const collection = `Erste Schritte ${marker}`
      const title = `Einstellungen ändern ${marker}`
      await sql`INSERT INTO kb_categories (id, slug, name, locale, is_public, position, created_at,
          updated_at)
        VALUES (${categoryUuid}, ${slug}, ${collection}, 'de', true, 0, NOW(), NOW())`
      // An article the workspace wrote in German, labelled as its main language.
      await sql`INSERT INTO kb_articles (id, category_id, slug, title, content, locale,
          principal_id, published_at, created_at, updated_at)
        VALUES (${articleUuid}, ${categoryUuid}, ${slug}, ${title},
          ${'Öffne die Einstellungen und wähle dein Konto.'}, 'de', ${author.id},
          NOW() - interval '1 minute', NOW(), NOW())`

      const visit = async (visitorLanguage: 'own' | 'main') =>
        withSettings(
          {
            feature_flags: { helpCenter: true },
            help_center_config: { 'locales.default': 'de', 'locales.additional': [] },
            language_config: { mainLanguage: 'de', visitorLanguage },
          },
          async () => {
            const context = await browser.newContext({
              locale: 'en-US',
              extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
            })
            const page = await context.newPage()
            try {
              await page.goto('/hc')
              await expect(page.getByText(collection).first()).toBeVisible({ timeout: 20_000 })
              return {
                lang: await page.locator('html').getAttribute('lang'),
                searchPlaceholder: await page
                  .getByRole('searchbox')
                  .first()
                  .getAttribute('placeholder'),
              }
            } finally {
              await snap(page, `hc-main-de-${visitorLanguage}`)
              await context.close()
            }
          }
        )

      // Each visitor's own language: English menus around the German articles.
      const own = await visit('own')
      expect(own.lang).toBe('en')

      // German for everyone: the same English browser gets German.
      const everyone = await visit('main')
      expect(everyone.lang).toBe('de')
      expect(everyone.searchPlaceholder).not.toBe(own.searchPlaceholder)

      // Search stems German: "Einstellung" finds "Einstellungen".
      await withSettings(
        {
          feature_flags: { helpCenter: true },
          help_center_config: { 'locales.default': 'de', 'locales.additional': [] },
          language_config: { mainLanguage: 'de', visitorLanguage: 'own' },
        },
        async () => {
          const res = await request.get(
            `/api/widget/kb-search?q=${encodeURIComponent('Einstellung')}`
          )
          expect(res.ok()).toBe(true)
          const { data } = (await res.json()) as { data: { articles: { title: string }[] } }
          expect(data.articles.map((a) => a.title)).toContain(title)
        }
      )
    }
  )

  test(
    'CUS-HC-L3 a French reader gets an untranslated collection and article in English, named, with a notice',
    { tag: ['@core', '@isolated'] },
    async ({ browser, marker }) => {
      const sql = supportDb()
      const [author] = await sql`SELECT id FROM principal WHERE role = 'admin' AND type = 'user'
        ORDER BY created_at LIMIT 1`
      const categoryUuid = toUuid(generateId('kb_category'))
      const articleUuid = toUuid(generateId('article'))
      const slug = `${marker}-${randomBytes(3).toString('hex')}`
      const collection = `Billing ${marker}`
      const title = `Download an invoice ${marker}`
      await sql`INSERT INTO kb_categories (id, slug, name, is_public, position, created_at, updated_at)
        VALUES (${categoryUuid}, ${slug}, ${collection}, true, 0, NOW(), NOW())`
      await sql`INSERT INTO kb_articles (id, category_id, slug, title, content, principal_id,
          published_at, created_at, updated_at)
        VALUES (${articleUuid}, ${categoryUuid}, ${slug}, ${title}, ${'Open Billing, then Invoices.'},
          ${author.id}, NOW() - interval '1 minute', NOW(), NOW())`
      const [{ url_id: articleUrlId }] =
        await sql`SELECT url_id FROM kb_articles WHERE id = ${articleUuid}`
      const [{ url_id: collectionUrlId }] =
        await sql`SELECT url_id FROM kb_categories WHERE id = ${categoryUuid}`
      const fr = catalogue('fr')
      const english = fr['portal.hc.language.en']

      await withSettings(
        {
          feature_flags: { helpCenter: true },
          help_center_config: { 'locales.additional': ['fr'] },
        },
        async () => {
          const context = await browser.newContext({
            locale: 'fr-FR',
            extraHTTPHeaders: { 'Accept-Language': 'fr-FR,fr;q=0.9' },
          })
          const page = await context.newPage()
          try {
            // The French home lists the untranslated collection, named in English.
            await page.goto('/hc/fr')
            const card = page.getByRole('link', { name: new RegExp(collection) })
            await expect(card).toBeVisible({ timeout: 20_000 })
            await expect(card.getByTestId('hc-language-label')).toHaveText(english)
            await expect(card.getByRole('heading', { name: collection })).toHaveAttribute(
              'lang',
              'en'
            )
            await snap(page, 'hc-fr-home-untranslated-collection')

            // Its page says it is not translated, and lists the article, named.
            await card.click()
            await expect(page).toHaveURL(new RegExp(`/hc/fr/collections/${collectionUrlId}-`))
            await expect(page.getByTestId('hc-fallback-notice')).toHaveText(
              fr['portal.hc.fallback.collection'].replace('{language}', english)
            )
            const row = page.getByRole('link', { name: new RegExp(title) })
            await expect(row.getByTestId('hc-language-label')).toHaveText(english)

            // The article opens in English with a French notice, instead of not being found.
            const response = await page.goto(`/hc/fr/articles/${articleUrlId}-${slug}`)
            expect(response?.status()).toBe(200)
            await expect(page.getByRole('heading', { level: 1, name: title })).toHaveAttribute(
              'lang',
              'en'
            )
            await expect(page.getByTestId('hc-fallback-notice')).toHaveText(
              fr['portal.hc.fallback.article'].replace('{language}', english)
            )
            await expect(page.locator('html')).toHaveAttribute('lang', 'fr')
            // Search engines are pointed at the English page, the real version.
            await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
              'href',
              new RegExp(`/hc/en/articles/${articleUrlId}-${slug}$`)
            )
            await snap(page, 'hc-fr-untranslated-article')
          } finally {
            await context.close()
          }
        }
      )
    }
  )

  test(
    'CUS-HC-L4 an admin makes German, an extra language, the main language: the German versions swap in, and back',
    { tag: ['@core', '@isolated'] },
    async ({ browser, asPerson, marker }) => {
      const sql = supportDb()
      const [author] = await sql`SELECT id FROM principal WHERE role = 'admin' AND type = 'user'
        ORDER BY created_at LIMIT 1`
      const categoryUuid = toUuid(generateId('kb_category'))
      const translatedUuid = toUuid(generateId('article'))
      const untranslatedUuid = toUuid(generateId('article'))
      const slug = `${marker}-${randomBytes(3).toString('hex')}`
      const english = { collection: `Account ${marker}`, title: `Change your password ${marker}` }
      const german = { collection: `Konto ${marker}`, title: `Passwort ändern ${marker}` }
      const untranslatedTitle = `Close your account ${marker}`
      await sql`INSERT INTO kb_categories (id, slug, name, is_public, position, created_at, updated_at)
        VALUES (${categoryUuid}, ${slug}, ${english.collection}, true, 0, NOW(), NOW())`
      await sql`INSERT INTO kb_category_translations (id, category_id, locale, name)
        VALUES (${toUuid(generateId('kb_category_translation'))}, ${categoryUuid}, 'de',
          ${german.collection})`
      for (const [uuid, title, articleSlug] of [
        [translatedUuid, english.title, `${slug}-a`],
        [untranslatedUuid, untranslatedTitle, `${slug}-b`],
      ]) {
        await sql`INSERT INTO kb_articles (id, category_id, slug, title, content, principal_id,
            published_at, created_at, updated_at)
          VALUES (${uuid}, ${categoryUuid}, ${articleSlug}, ${title}, ${`${title}.`}, ${author.id},
            NOW() - interval '1 minute', NOW(), NOW())`
      }
      await sql`INSERT INTO kb_article_translations (id, article_id, locale, title, content,
          content_json, status)
        VALUES (${toUuid(generateId('kb_article_translation'))}, ${translatedUuid}, 'de',
          ${german.title}, ${'Öffne dein Konto.'}, NULL, 'published')`
      const urlIdOf = async (uuid: string) =>
        (await sql`SELECT url_id FROM kb_articles WHERE id = ${uuid}`)[0].url_id as number
      const translatedPath = `/hc/de/articles/${await urlIdOf(translatedUuid)}-${slug}-a`
      const untranslatedPath = `/hc/de/articles/${await urlIdOf(untranslatedUuid)}-${slug}-b`
      const de = catalogue('de')
      const mainLanguage = async () =>
        (await sql`SELECT language_config FROM settings LIMIT 1`)[0].language_config as
          string | null

      await withSettings(
        {
          feature_flags: { helpCenter: true },
          help_center_config: { 'locales.default': 'en', 'locales.additional': ['de'] },
          language_config: { mainLanguage: 'en', visitorLanguage: 'own' },
        },
        async () => {
          const admin = await asPerson('admin')
          const switchTo = async (option: RegExp, action: string) => {
            await admin.goto('/admin/settings/general')
            await admin.locator('#main-language').click()
            await admin.getByRole('option', { name: option }).click()
            const dialog = admin.getByRole('alertdialog')
            await expect(dialog.getByTestId('main-language-confirm')).toContainText(
              /have a (German|English) version, which becomes their main text/,
              { timeout: 20_000 }
            )
            await snap(admin, `general-main-language-confirm-${action}`)
            await dialog.getByRole('button', { name: action }).click()
            await expect(dialog).toBeHidden({ timeout: 20_000 })
          }

          try {
            await switchTo(/^German \(Deutsch\)$/, 'Switch to German')
            expect(await mainLanguage()).toContain('"mainLanguage":"de"')
            await expect(admin.locator('#main-language')).toHaveText('German (Deutsch)')
            await expect(admin.getByText('German for everyone')).toBeVisible()
            await snap(admin, 'general-language-card-german')

            // The help center's languages name German as the main language.
            await admin.goto('/admin/settings/help-center?tab=domains-languages')
            const mainRow = admin.getByTestId('hc-main-language')
            await expect(mainRow).toContainText('German')
            await expect(mainRow.getByRole('link', { name: 'Change in General' })).toHaveAttribute(
              'href',
              '/admin/settings/general'
            )
            await snap(admin, 'help-center-languages-main-row')

            const context = await browser.newContext({
              locale: 'en-US',
              extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' },
            })
            const page = await context.newPage()
            try {
              // The German version is now the article itself.
              await page.goto(translatedPath)
              await expect(page.getByRole('heading', { level: 1, name: german.title })).toBeVisible(
                { timeout: 20_000 }
              )
              await expect(page.getByTestId('hc-fallback-notice')).toHaveCount(0)

              // The article with no German version keeps its English text, with a German notice.
              await page.goto(untranslatedPath)
              await expect(
                page.getByRole('heading', { level: 1, name: untranslatedTitle })
              ).toHaveAttribute('lang', 'en')
              await expect(page.getByTestId('hc-fallback-notice')).toHaveText(
                de['portal.hc.fallback.article'].replace('{language}', de['portal.hc.language.en'])
              )
              await snap(page, 'hc-main-de-untranslated-article')

              // English is now an extra language, read from the swapped-out text.
              await page.goto(translatedPath.replace('/hc/de/', '/hc/en/'))
              await expect(
                page.getByRole('heading', { level: 1, name: english.title })
              ).toBeVisible()
            } finally {
              await context.close()
            }
          } finally {
            // Back to English through the same screen: the swap reverses.
            await switchTo(/^English$/, 'Switch to English')
            expect(await mainLanguage()).toContain('"mainLanguage":"en"')
            const [row] =
              await sql`SELECT locale, title FROM kb_articles WHERE id = ${translatedUuid}`
            expect(row).toEqual({ locale: 'en', title: english.title })
            await admin.context().close()
          }
        }
      )
    }
  )
})
