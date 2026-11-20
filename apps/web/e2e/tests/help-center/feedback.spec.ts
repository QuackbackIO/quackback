/**
 * Article feedback on the public help center: helpful and unhelpful votes,
 * reasons, signed-in vote changes and signed-out de-duplication.
 *
 * Journeys: HC-F-01, HC-F-02, HC-F-03, HC-F-04, HC-F-05.
 */
import type { Page } from '@playwright/test'
import { generateId } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { supportEnv } from '../../support/env'
import { callServerFn } from '../../support/server-fns'
import { mintCustomer, portalContext } from '../../support/widget-portal'
import { waitForHydration } from '../../utils/helpers'
import {
  articlePath,
  articleRow,
  hcApi,
  hcArticle,
  hcCategory,
  type HcArticle,
} from '../../product/help-center'

async function seed(playwright: Parameters<typeof hcApi>[0], marker: string): Promise<HcArticle> {
  const hc = await hcApi(playwright)
  const category = await hcCategory(hc, `Feedback ${marker}`)
  return hcArticle(hc, { categoryId: category.id, title: `Rated ${marker}`, publish: true })
}

async function counts(article: HcArticle) {
  const row = await articleRow(article.uuid)
  return { helpful: row?.helpful_count, notHelpful: row?.not_helpful_count }
}

async function feedbackRows(article: HcArticle) {
  return supportDb()`SELECT id, principal_id, helpful, reason FROM kb_article_feedback
    WHERE article_id = ${article.uuid} ORDER BY created_at`
}

/** The feedback card's Yes/No, once the page has hydrated. */
async function vote(page: Page, answer: 'Yes' | 'No') {
  const button = page.getByRole('button', { name: answer, exact: true })
  await waitForHydration(button)
  await button.click()
}

test(
  'HC-F-01 a visitor marks an article helpful once',
  { tag: '@smoke' },
  async ({ page, marker, playwright }) => {
    const article = await seed(playwright, marker)
    await page.goto(articlePath(article))
    await expect(page.getByText('Your feedback shapes what we write next.')).toBeVisible()
    const recorded = page.waitForResponse((r) => r.url().includes('/_serverFn/'))
    await vote(page, 'Yes')
    await recorded
    await expect(page.getByText('Thanks, glad it landed.')).toBeVisible()
    await expect.poll(() => counts(article)).toEqual({ helpful: 1, notHelpful: 0 })
    const rows = await feedbackRows(article)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ helpful: true, principal_id: null })

    // Pressing Yes again sends nothing.
    await page.getByRole('button', { name: 'Yes', exact: true }).click()
    await page.waitForTimeout(500)
    expect(await feedbackRows(article)).toHaveLength(1)
  }
)

test(
  'HC-F-02 Not helpful asks for an optional reason and sends it once',
  { tag: '@core' },
  async ({ page, marker, playwright }) => {
    const article = await seed(playwright, marker)
    await page.goto(articlePath(article))
    await vote(page, 'No')
    await expect(page.getByText("Noted. We'll revisit this article.")).toBeVisible()
    await expect.poll(() => counts(article)).toEqual({ helpful: 0, notHelpful: 1 })

    const box = page.getByPlaceholder('Optional, but it tells us what to fix.')
    const send = page.getByRole('button', { name: 'Send' })
    await expect(send).toBeDisabled()
    await box.fill('   ')
    await expect(send).toBeDisabled()
    await expect(box).toHaveAttribute('maxlength', '1000')
    await box.fill(`Missing the export steps ${marker}`)
    await send.click()
    await expect(
      page.getByText('Thanks. That goes to whoever maintains this article.')
    ).toBeVisible()
    await expect(box).toBeHidden()
    await expect
      .poll(async () => (await feedbackRows(article))[0]?.reason)
      .toBe(`Missing the export steps ${marker}`)
  }
)

test(
  'HC-F-03 a reason is refused when blank, too long, second, on a helpful vote or unknown',
  { tag: '@core' },
  async ({ marker, playwright }) => {
    const article = await seed(playwright, marker)
    const anon = await playwright.request.newContext({ baseURL: supportEnv().baseUrl })
    const voteFn = (helpful: boolean) =>
      callServerFn<{ feedbackId: string }>(anon, 'recordArticleFeedbackFn', {
        articleId: article.id,
        helpful,
      })
    const reason = (feedbackId: string, text: string) =>
      callServerFn(anon, 'submitArticleFeedbackReasonFn', { feedbackId, reason: text })

    const no = await voteFn(false)
    expect(no.ok, no.error).toBe(true)
    const yes = await voteFn(true)
    expect(yes.ok, yes.error).toBe(true)

    expect((await reason(no.data.feedbackId, '   ')).ok).toBe(false)
    expect((await reason(no.data.feedbackId, 'x'.repeat(1001))).ok).toBe(false)
    const first = await reason(no.data.feedbackId, `First ${marker}`)
    expect(first.ok, first.error).toBe(true)
    const second = await reason(no.data.feedbackId, `Second ${marker}`)
    expect(second.code).toBe('FEEDBACK_REASON_UNAVAILABLE')
    expect((await reason(yes.data.feedbackId, `On yes ${marker}`)).code).toBe(
      'FEEDBACK_REASON_UNAVAILABLE'
    )
    expect((await reason(generateId('kb_article_feedback'), 'x')).code).toBe(
      'FEEDBACK_REASON_UNAVAILABLE'
    )
    const reasons = (await feedbackRows(article)).map((r) => r.reason).filter(Boolean)
    expect(reasons).toEqual([`First ${marker}`])
  }
)

test(
  'HC-F-04 a signed-in user has one vote that moves between the counters',
  { tag: '@core' },
  async ({ browser, marker, playwright, customerEmail }) => {
    const article = await seed(playwright, marker)
    const customer = await mintCustomer({ email: customerEmail })
    const context = await portalContext(browser, customer)
    const page = await context.newPage()
    await page.goto(articlePath(article))
    await vote(page, 'Yes')
    await expect.poll(() => counts(article)).toEqual({ helpful: 1, notHelpful: 0 })
    await page.getByRole('button', { name: 'No', exact: true }).click()
    await expect.poll(() => counts(article)).toEqual({ helpful: 0, notHelpful: 1 })

    // After a reload the page forgets the vote, but the server still keeps one.
    await page.reload()
    await vote(page, 'No')
    await expect(page.getByText("Noted. We'll revisit this article.")).toBeVisible()
    const again = await callServerFn(context.request, 'recordArticleFeedbackFn', {
      articleId: article.id,
      helpful: true,
    })
    expect(again.ok, again.error).toBe(true)
    await expect.poll(() => counts(article)).toEqual({ helpful: 1, notHelpful: 0 })
    const rows = await feedbackRows(article)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ helpful: true, principal_id: customer.principalUuid })
    await context.close()
  }
)

test(
  'HC-F-05 a signed-out visitor who flips Yes to No is counted once',
  {
    tag: ['@core', '@quarantine'],
    annotation: {
      type: 'quarantine',
      description:
        'HC-B2: recordArticleFeedback skips the existing-vote lookup when there is no principal and always inserts, so a flip adds one helpful and one not-helpful vote',
    },
  },
  async ({ page, marker, playwright }) => {
    const article = await seed(playwright, marker)
    await page.goto(articlePath(article))
    await vote(page, 'Yes')
    await expect.poll(() => counts(article)).toEqual({ helpful: 1, notHelpful: 0 })
    await page.getByRole('button', { name: 'No', exact: true }).click()
    await expect(page.getByText("Noted. We'll revisit this article.")).toBeVisible()
    await page.waitForTimeout(1_000)
    const c = await counts(article)
    expect((c.helpful as number) + (c.notHelpful as number)).toBe(1)
  }
)
