/**
 * The help center inside the widget (the Help tab). The tab switch is
 * workspace-wide (widget_config.tabs.help), so these are `@isolated`.
 *
 * Journeys: HC-W-01, HC-W-02, HC-W-03, HC-W-04, HC-W-06, HC-W-10.
 */
import type { FrameLocator, Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { ISOLATED, ISOLATED_SKIP } from '../../support/automation'
import { supportDb } from '../../support/db'
import { SUPPORT_FLAGS_ON, WIDGET_BASELINE, withSettings } from '../../support/isolated-settings'
import { openWidget } from '../../support/widget-portal'
import { articleRow, hcApi, hcArticle, hcCategory, searchWord } from '../../product/help-center'

const HELP_ON = {
  feature_flags: { ...SUPPORT_FLAGS_ON, helpCenter: true },
  widget_config: { ...WIDGET_BASELINE, 'tabs.help': true },
}

function helpTab(widget: FrameLocator) {
  return widget.getByRole('button', { name: 'Help', exact: true })
}

async function openHelp(page: Page) {
  const widget = await openWidget(page)
  await helpTab(widget).click()
  await expect(widget.getByRole('textbox', { name: 'Search help articles' })).toBeVisible()
  return widget
}

test.describe('the widget Help tab', { tag: '@isolated' }, () => {
  test.beforeEach(() => {
    test.skip(!ISOLATED, ISOLATED_SKIP)
  })

  test(
    'HC-W-01 the Help tab shows only with the tab setting and the product both on',
    { tag: '@core' },
    async ({ browser }) => {
      for (const [patch, shown] of [
        [HELP_ON, true],
        [{ ...HELP_ON, widget_config: { ...WIDGET_BASELINE, 'tabs.help': false } }, false],
        [{ ...HELP_ON, feature_flags: { ...SUPPORT_FLAGS_ON, helpCenter: false } }, false],
      ] as const) {
        await withSettings(patch, async () => {
          const context = await browser.newContext()
          const page = await context.newPage()
          const widget = await openWidget(page)
          await expect(widget.getByRole('button', { name: 'Messages', exact: true })).toBeVisible()
          await expect(helpTab(widget)).toHaveCount(shown ? 1 : 0)
          await context.close()
        })
      }
    }
  )

  test(
    'HC-W-02 HC-W-03 the Help tab lists collections; a collection lists its articles; an article opens',
    { tag: '@core' },
    async ({ page, marker, playwright }) => {
      const hc = await hcApi(playwright)
      const category = await hcCategory(hc, `Widget guides ${marker}`, {
        description: `Guides for ${marker}`,
      })
      const article = await hcArticle(hc, {
        categoryId: category.id,
        title: `Widget doc ${marker}`,
        description: `Widget summary ${marker}`,
        content: `Widget body text ${marker}.`,
        publish: true,
      })
      await withSettings(HELP_ON, async () => {
        const widget = await openHelp(page)
        await expect(widget.getByText('Browse collections')).toBeVisible()
        const collection = widget.getByRole('button').filter({ hasText: category.name })
        await expect(collection).toContainText(`Guides for ${marker}`)
        await expect(collection).toContainText('1 article')
        await collection.click()

        await expect(widget.getByText(category.name).first()).toBeVisible()
        const row = widget.getByRole('button').filter({ hasText: article.title })
        await expect(row).toContainText(`Widget summary ${marker}`)
        await row.click()
        await expect(widget.getByRole('heading', { name: article.title })).toBeVisible()
        await expect(widget.getByText(`Widget body text ${marker}.`)).toBeVisible()
        await expect(widget.getByText('Was this helpful?')).toBeVisible()
      })
    }
  )

  test(
    'HC-W-04 the host page opens an article by id or slug; a draft is not found',
    { tag: '@core' },
    async ({ page, marker, playwright }) => {
      const hc = await hcApi(playwright)
      const category = await hcCategory(hc, `Opened ${marker}`)
      const article = await hcArticle(hc, {
        categoryId: category.id,
        title: `Opened doc ${marker}`,
        publish: true,
      })
      const draft = await hcArticle(hc, { categoryId: category.id, title: `Draft doc ${marker}` })
      await withSettings(HELP_ON, async () => {
        const widget = await openWidget(page)
        const open = (articleId: string) =>
          page.evaluate((id) => {
            const q = (window as unknown as { Quackback: (...a: unknown[]) => void }).Quackback
            q('open', { articleId: id })
          }, articleId)
        for (const ref of [
          article.id,
          article.id.replace(/^article_/, 'kb_article_'),
          article.slug,
        ]) {
          await open(ref)
          await expect(widget.getByRole('heading', { name: article.title }), ref).toBeVisible()
          await expect(widget.getByText(category.name).first()).toBeVisible()
        }
        await open(draft.id)
        await expect(widget.getByText('Article not found')).toBeVisible()
        await expect(widget.getByRole('heading', { name: draft.title })).toHaveCount(0)
      })
    }
  )

  test(
    'HC-W-06 widget search finds an article, keeps the query on the way back, and says when nothing matches',
    { tag: '@core' },
    async ({ page, marker, playwright }) => {
      const hc = await hcApi(playwright)
      const word = searchWord()
      const category = await hcCategory(hc, `Searchable ${marker}`)
      const article = await hcArticle(hc, {
        categoryId: category.id,
        title: `Calibrating the ${word} sensor`,
        publish: true,
      })
      await withSettings(HELP_ON, async () => {
        const widget = await openHelp(page)
        const box = widget.getByRole('textbox', { name: 'Search help articles' })
        await box.fill(word)
        const result = widget.getByRole('button').filter({ hasText: article.title })
        await expect(result).toContainText(category.name)
        await result.click()
        await expect(widget.getByRole('heading', { name: article.title })).toBeVisible()
        await widget.getByRole('button', { name: /back/i }).first().click()
        await expect(box).toHaveValue(word)
        await expect(result).toBeVisible()

        await box.fill(searchWord())
        await expect(widget.getByText('No results found')).toBeVisible()
        await expect(widget.getByText('Try different keywords or browse categories.')).toBeVisible()
        await widget.getByRole('button', { name: 'Clear search' }).click()
        await expect(box).toHaveValue('')
        await expect(widget.getByText('Browse collections')).toBeVisible()
      })
    }
  )

  test(
    'HC-W-10 a widget vote is stored against the visitor session and flips without adding rows',
    { tag: '@core' },
    async ({ page, marker, playwright }) => {
      const hc = await hcApi(playwright)
      const category = await hcCategory(hc, `Widget votes ${marker}`)
      const article = await hcArticle(hc, {
        categoryId: category.id,
        title: `Widget voted ${marker}`,
        publish: true,
      })
      await withSettings(HELP_ON, async () => {
        const widget = await openWidget(page)
        await page.evaluate((id) => {
          const q = (window as unknown as { Quackback: (...a: unknown[]) => void }).Quackback
          q('open', { articleId: id })
        }, article.id)
        await expect(widget.getByRole('heading', { name: article.title })).toBeVisible()
        const yes = widget.getByRole('button', { name: 'Yes, this helped' })
        await yes.click()
        await expect.poll(async () => (await articleRow(article.uuid))?.helpful_count).toBe(1)
        await widget.getByRole('button', { name: "No, this didn't help" }).click()
        await expect
          .poll(async () => {
            const row = await articleRow(article.uuid)
            return [row?.helpful_count, row?.not_helpful_count]
          })
          .toEqual([0, 1])
        const rows = await supportDb()`SELECT principal_id, helpful FROM kb_article_feedback
          WHERE article_id = ${article.uuid}`
        expect(rows).toHaveLength(1)
        expect(rows[0].principal_id).not.toBeNull()
        expect(rows[0].helpful).toBe(false)
      })
    }
  )

  test(
    'HC-W-10 the first widget vote of a fresh visitor confirms it',
    {
      tag: '@core',
    },
    async ({ page, marker, playwright }) => {
      const hc = await hcApi(playwright)
      const category = await hcCategory(hc, `Widget thanks ${marker}`)
      const article = await hcArticle(hc, {
        categoryId: category.id,
        title: `Widget thanks ${marker}`,
        publish: true,
      })
      await withSettings(HELP_ON, async () => {
        const widget = await openWidget(page)
        await page.evaluate((id) => {
          const q = (window as unknown as { Quackback: (...a: unknown[]) => void }).Quackback
          q('open', { articleId: id })
        }, article.id)
        const yes = widget.getByRole('button', { name: 'Yes, this helped' })
        await yes.click()
        await expect.poll(async () => (await articleRow(article.uuid))?.helpful_count).toBe(1)
        await expect(widget.getByText('Thanks, glad it helped.')).toBeVisible()
        await expect(yes).toHaveAttribute('aria-pressed', 'true')
      })
    }
  )
})
