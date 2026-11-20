/**
 * The public help center in another language (/hc/<locale>/...). The enabled
 * languages are workspace-wide, so every test here is `@isolated`.
 *
 * Journeys: HC-P-24, HC-P-27.
 */
import { test, expect } from '../../support/fixtures'
import { ISOLATED, ISOLATED_SKIP } from '../../support/automation'
import { supportDb } from '../../support/db'
import { withSettings } from '../../support/isolated-settings'
import {
  articlePath,
  hcApi,
  hcArticle,
  hcCategory,
  type HcArticle,
} from '../../product/help-center'

const FRENCH = {
  help_center_config: {
    'locales.additional': ['fr'],
    'locales.chrome.fr': {
      homepageTitle: 'Comment pouvons-nous vous aider ?',
      homepageDescription: 'Cherchez dans nos articles',
      searchPlaceholder: '',
    },
  },
}

async function translate(article: HcArticle, title: string) {
  await supportDb()`INSERT INTO kb_article_translations
      (id, article_id, locale, title, content, status, created_at, updated_at)
    VALUES (gen_random_uuid(), ${article.uuid}, 'fr', ${title}, ${`Texte de ${title}.`},
      'published', NOW(), NOW())`
}

test.describe('the help center in French', { tag: '@isolated' }, () => {
  test.beforeEach(() => {
    test.skip(!ISOLATED, ISOLATED_SKIP)
  })

  test(
    'HC-P-24 /hc/fr shows the French homepage texts and only translated content',
    { tag: '@core' },
    async ({ page, marker, playwright }) => {
      const hc = await hcApi(playwright)
      const category = await hcCategory(hc, `Localised ${marker}`)
      const translated = await hcArticle(hc, {
        categoryId: category.id,
        title: `English only? no ${marker}`,
        publish: true,
      })
      await withSettings(FRENCH, async () => {
        await translate(translated, `Traduit ${marker}`)
        await page.goto('/hc/fr')
        await expect(
          page.getByRole('heading', { level: 1, name: 'Comment pouvons-nous vous aider ?' })
        ).toBeVisible()
        await expect(page.getByText('Cherchez dans nos articles')).toBeVisible()
        await page.goto(articlePath(translated, 'fr'))
        await expect(
          page.getByRole('heading', { level: 1, name: `Traduit ${marker}` })
        ).toBeVisible()
      })
    }
  )

  test(
    'HC-P-27 an untranslated article has no French page, and related links on a French page work',
    {
      tag: ['@core', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'HC-B26: related articles on a localised article page are loaded without the language, so they show English titles and link to /hc/<locale>/articles/... that 404 when untranslated',
      },
    },
    async ({ page, request, marker, playwright }) => {
      const hc = await hcApi(playwright)
      const category = await hcCategory(hc, `Related fr ${marker}`)
      const main = await hcArticle(hc, {
        categoryId: category.id,
        title: `Router setup guide ${marker}`,
        content: `Router setup steps. ${marker}`,
        publish: true,
      })
      const sibling = await hcArticle(hc, {
        categoryId: category.id,
        title: `Router setup advanced ${marker}`,
        content: `Router setup advanced steps. ${marker}`,
        publish: true,
      })
      await withSettings(FRENCH, async () => {
        await translate(main, `Guide du routeur ${marker}`)
        // Strict: no English fallback on portal URLs.
        const untranslated = await request.get(articlePath(sibling, 'fr'), {
          headers: { cookie: 'e2e=1' },
          maxRedirects: 0,
        })
        expect(untranslated.status()).toBe(404)

        await page.goto(articlePath(main, 'fr'))
        await expect(
          page.getByRole('heading', { level: 1, name: `Guide du routeur ${marker}` })
        ).toBeVisible()
        const related = page.getByRole('link', { name: new RegExp(sibling.title) })
        await expect(related).toBeVisible()
        const href = (await related.getAttribute('href')) ?? ''
        const res = await request.get(href, { headers: { cookie: 'e2e=1' } })
        expect(res.status(), href).toBe(200)
      })
    }
  )
})
