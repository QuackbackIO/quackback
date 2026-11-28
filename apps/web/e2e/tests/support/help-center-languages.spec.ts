/**
 * Help center pages in another language (area CUS-HC-L): a translated article
 * shows its own body, and a page whose address names a language reads in that
 * language, whatever the browser asks for.
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
})
