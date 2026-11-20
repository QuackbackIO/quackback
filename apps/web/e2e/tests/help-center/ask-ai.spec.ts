/**
 * Ask AI on the public help center (/api/widget/kb-ask): grounded answers,
 * misses that never reach the model, and what the model is shown.
 *
 * Journeys: HC-S-10, HC-S-11, HC-S-12, HC-S-17.
 *
 * Current code skips the model when retrieval finds no article (HC-S-11);
 * these tests pin that. Rules for the fake AI are keyed on the marker, which
 * reaches the prompt through the retrieved article's body.
 */
import type { APIRequestContext } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { clientIp } from '../../support/api-client'
import { fakeAi } from '../../support/fake-ai-client'
import { waitForHydration } from '../../utils/helpers'
import { articlePath, hcApi, hcArticle, hcCategory, searchWord } from '../../product/help-center'

const MISS = "I couldn't find a reliable answer to that in the help articles"

/** Ask kb-ask one question as a signed-out visitor; returns the raw stream text. */
async function ask(request: APIRequestContext, question: string): Promise<string> {
  const res = await request.post('/api/widget/kb-ask', {
    headers: { 'x-e2e-client-ip': clientIp() },
    data: {
      threadId: `t-${Date.now()}`,
      runId: `r-${Date.now()}`,
      messages: [{ id: 'm1', role: 'user', content: question }],
      tools: [],
      context: [],
      state: {},
      forwardedProps: {},
    },
  })
  const text = await res.text()
  expect(res.status(), text.slice(0, 300)).toBe(200)
  return text
}

test.afterEach(async ({ marker }) => {
  await fakeAi.clear(marker)
})

test(
  'HC-S-10 Ask AI on /hc streams a grounded answer citing the article',
  { tag: '@core' },
  async ({ page, marker, playwright }) => {
    const hc = await hcApi(playwright)
    const word = searchWord()
    const category = await hcCategory(hc, `Ask ${marker}`)
    const article = await hcArticle(hc, {
      categoryId: category.id,
      title: `Pairing the ${word} remote`,
      content: `To pair the ${word} remote, hold the blue button for five seconds. ${marker}`,
      publish: true,
    })
    const answer = `${marker} hold the blue button for five seconds`
    await fakeAi.script({
      marker,
      json: { kind: 'grounded', answer: `${answer} [1].`, sources: [{ articleId: '1' }] },
    })
    await page.context().setExtraHTTPHeaders({ 'x-e2e-client-ip': clientIp() })
    await page.goto('/hc')
    const box = page.locator('#hc-search')
    await waitForHydration(box)
    await expect(box).toHaveAttribute('placeholder', /Ask AI/)
    await box.fill(`How do I pair the ${word} remote?`)
    await page.getByRole('button', { name: 'Use AI to answer your question in seconds' }).click()
    await expect(page.getByText(answer, { exact: false })).toBeVisible({ timeout: 20_000 })
    const source = page.getByRole('button', { name: `1. ${article.title}` })
    await expect(source).toBeVisible()
    await source.click()
    await expect(page).toHaveURL(new RegExp(`${articlePath(article)}$`))
  }
)

test(
  'HC-S-11 a question nothing in the help center matches never reaches the model',
  { tag: '@core' },
  async ({ request }) => {
    const nonsense = `${searchWord()} ${searchWord()}`
    const text = await ask(request, nonsense)
    expect(text).toContain(MISS)
    expect(await fakeAi.requests({ contains: nonsense, endpoint: 'chat' })).toEqual([])
  }
)

test(
  'HC-S-12 a declared miss keeps its words; a grounded answer citing nothing valid becomes the miss',
  { tag: '@core' },
  async ({ request, marker, playwright }) => {
    const hc = await hcApi(playwright)
    const word = searchWord()
    const category = await hcCategory(hc, `No answer ${marker}`)
    await hcArticle(hc, {
      categoryId: category.id,
      title: `Billing ${word} cycles`,
      content: `Invoices go out monthly. ${marker}`,
      publish: true,
    })
    await fakeAi.script({
      marker,
      json: { kind: 'no_answer', answer: `Nothing on that ${marker}`, sources: [] },
    })
    const declined = await ask(request, `Billing ${word} cycles`)
    // A declared miss keeps the model's own words and cites nothing.
    expect(declined).toContain(`Nothing on that ${marker}`)
    expect(declined).toContain('no_answer')
    expect(await fakeAi.requests({ contains: marker, endpoint: 'chat' })).not.toEqual([])

    await fakeAi.clear(marker)
    await fakeAi.script({
      marker,
      json: { kind: 'grounded', answer: `Made up ${marker} [7].`, sources: [{ articleId: '7' }] },
    })
    const uncited = await ask(request, `Billing ${word} cycles`)
    expect(uncited).toContain(MISS)
  }
)

test(
  'HC-S-17 the model is shown only articles the visitor may read',
  { tag: '@core' },
  async ({ request, marker, playwright }) => {
    const hc = await hcApi(playwright)
    const word = searchWord()
    const secret = searchWord()
    const open = await hcCategory(hc, `Readable ${marker}`)
    const closed = await hcCategory(hc, `Unreadable ${marker}`, { isPublic: false })
    await hcArticle(hc, {
      categoryId: open.id,
      title: `Resetting the ${word} hub`,
      content: `Press reset on the ${word} hub. ${marker}`,
      publish: true,
    })
    await hcArticle(hc, {
      categoryId: closed.id,
      title: `Resetting the ${word} hub internally`,
      content: `Internal only ${secret}. ${marker}`,
      publish: true,
    })
    await hcArticle(hc, {
      categoryId: open.id,
      title: `Resetting the ${word} hub draft`,
      content: `Draft only ${secret}. ${marker}`,
    })
    await fakeAi.script({
      marker,
      json: {
        kind: 'grounded',
        answer: `Press reset ${marker} [1].`,
        sources: [{ articleId: '1' }],
      },
    })
    const text = await ask(request, `How do I reset the ${word} hub?`)
    expect(text).toContain(`Press reset ${marker}`)
    const prompts = await fakeAi.requests({ contains: marker, endpoint: 'chat' })
    expect(prompts.length).toBeGreaterThan(0)
    expect(await fakeAi.requests({ contains: secret, endpoint: 'chat' })).toEqual([])
  }
)
