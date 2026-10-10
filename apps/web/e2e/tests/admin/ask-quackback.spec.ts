import { test, expect, type Page } from '@playwright/test'
import { waitForHydration } from '../../utils/helpers'
import { isCopilotModelConfigured, setCopilotHome } from '../../utils/db-helpers'

// The two groups switch the workspace flag, so they never run side by side.
test.describe.configure({ mode: 'serial' })

const ANSWER = 'Your brand color is ready to review.'

/** Every Copilot turn is answered here, so no model is ever called. */
async function stubCopilot(page: Page) {
  const turns: string[] = []
  await page.route('**/api/admin/assistant/workspace', async (route) => {
    const body = route.request().postDataJSON() as {
      threadId?: string
      runId?: string
      forwardedProps?: { threadKey?: string }
    }
    const threadKey = body.forwardedProps?.threadKey ?? ''
    turns.push(threadKey)
    const ids = { threadId: body.threadId, runId: body.runId }
    const result = {
      threadKey,
      messageId: `stub-${turns.length}`,
      text: ANSWER,
      citations: [],
      proposedActions: [],
      navigation: [],
    }
    const frames = [
      { type: 'RUN_STARTED', ...ids, timestamp: Date.now() },
      { type: 'RUN_FINISHED', ...ids, finishReason: 'stop', result, timestamp: Date.now() },
    ]
    await route.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream' },
      body: frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(''),
    })
  })
  return turns
}

// The first open loads the dialog and its strings, which a cold dev server compiles.
const FIRST_OPEN = { timeout: 15_000 }

const searchRow = (page: Page) => page.getByRole('button', { name: 'Search', exact: true }).first()
const homeComposer = (page: Page) =>
  page.getByRole('textbox', { name: 'Ask Copilot anything', exact: true })

test.describe('search with Copilot off', () => {
  test.beforeAll(() => setCopilotHome(false))

  test('searches and navigates without any Copilot request', async ({ page }) => {
    const turns: string[] = []
    page.on('request', (request) => {
      if (request.url().includes('/api/admin/assistant/workspace')) turns.push(request.url())
    })
    await page.goto('/admin')
    const trigger = searchRow(page)
    await waitForHydration(trigger)
    await expect(homeComposer(page)).toHaveCount(0)
    await page.keyboard.press('Control+k')
    const dialog = page.getByRole('dialog')
    const input = dialog.getByRole('combobox')
    await expect(input).toBeFocused(FIRST_OPEN)
    await input.fill('logo')
    const portal = dialog.getByRole('option', { name: 'Portal', exact: true })
    await expect(portal).toBeVisible()
    await expect(dialog.getByRole('option', { name: /Copilot/ })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await trigger.click()
    await expect(dialog.getByRole('combobox')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(trigger).toBeFocused()
    await trigger.click()
    await dialog.getByRole('combobox').fill('logo')
    await dialog.getByRole('option', { name: 'Portal', exact: true }).click()
    await expect(page).toHaveURL(/\/admin\/settings\/portal/)
    expect(turns).toEqual([])
  })

  test('the palette opens from a product page and navigates with the keyboard', async ({
    page,
  }) => {
    await page.goto('/admin/feedback')
    await waitForHydration(searchRow(page))
    await page.keyboard.press('Control+k')
    const dialog = page.getByRole('dialog')
    const input = dialog.getByRole('combobox')
    await expect(input).toBeFocused(FIRST_OPEN)
    await input.fill('tags')
    await expect(dialog.getByRole('option', { name: 'Tags', exact: true })).toBeVisible()
    await input.press('Enter')
    await expect(page).toHaveURL(/\/admin\/settings\/tags/)
    await expect(dialog).not.toBeVisible()
  })

  test('the tour ends on the sidebar Search row without leaving Home', async ({ page }) => {
    await page.goto('/admin')
    const help = page.getByRole('button', { name: 'Help', exact: true }).first()
    await waitForHydration(help)
    await expect(page.locator('[data-tour="search"]')).toHaveCount(1)
    await help.focus()
    await page.keyboard.press('ArrowDown')
    await page.getByRole('menuitem', { name: 'Replay the tour', exact: true }).focus()
    await page.keyboard.press('Enter')
    const coachmark = page.getByRole('dialog')
    await expect(coachmark).toBeFocused(FIRST_OPEN)
    for (let stop = 0; stop < 5; stop++) {
      if (await coachmark.getByText('Search.', { exact: true }).isVisible()) {
        await expect(page).toHaveURL(/\/admin\/?$/)
        await page.keyboard.press('Escape')
        await expect(coachmark).not.toBeVisible()
        return
      }
      await page.keyboard.press('ArrowRight')
      await expect(coachmark).toBeFocused()
    }
    throw new Error('The tour did not reach the Search row')
  })
})

test.describe('Copilot on Home', () => {
  // Copilot turns are stubbed; the server only has to offer chat.
  test.skip(!isCopilotModelConfigured(), 'needs a chat model configured on the e2e server')
  test.beforeAll(() => setCopilotHome(true))
  test.afterAll(() => setCopilotHome(false))

  async function startChat(page: Page, question: string) {
    await page.goto('/admin')
    const composer = homeComposer(page)
    await waitForHydration(composer)
    await composer.fill(question)
    await composer.press('Enter')
    await expect(page).toHaveURL(/copilotThread=workspace/)
    await expect(page.getByText(ANSWER)).toBeVisible()
  }

  test('a chat opens inline: the sidebar stays, the overview folds away and comes back', async ({
    page,
  }) => {
    const turns = await stubCopilot(page)
    const question = `Set my brand color ${Date.now()}`
    await startChat(page, question)
    expect(turns).toHaveLength(1)
    const sidebarSearch = page.locator('[data-tour="search"]')
    const welcome = page.getByRole('heading', { name: /^Welcome/ })
    await expect(sidebarSearch).toBeVisible()
    await expect(welcome).toBeHidden()
    await expect(homeComposer(page)).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/\/admin\/?$/)
    await expect(welcome).toBeVisible()
    await expect(sidebarSearch).toBeVisible()
    await expect(homeComposer(page)).toHaveValue('')
    await page.getByRole('button', { name: new RegExp(`Continue: ${question}`) }).click()
    await expect(page.getByText(question).first()).toBeVisible()
    await expect(welcome).toBeHidden()
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(page).toHaveURL(/\/admin\/?$/)
    await expect(welcome).toBeVisible()
    await page.goForward()
    await expect(welcome).toBeHidden()
    await page.goBack()
    await expect(page).toHaveURL(/\/admin\/?$/)
    await expect(welcome).toBeVisible()
    expect(turns).toHaveLength(1)
  })

  test('Ctrl+K opens search over the chat', async ({ page }) => {
    await stubCopilot(page)
    await startChat(page, `Find our refund policy ${Date.now()}`)
    await page.keyboard.press('Control+k')
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('combobox')).toBeFocused(FIRST_OPEN)
    await page.keyboard.press('Escape')
    await expect(dialog).not.toBeVisible()
    await expect(page).toHaveURL(/copilotThread=/)
    await page.keyboard.press('Escape')
    await expect(page).toHaveURL(/\/admin\/?$/)
  })

  test('the chat fits a phone', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await stubCopilot(page)
    await startChat(page, `Invite my team ${Date.now()}`)
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth
    )
    expect(overflow).toBeLessThanOrEqual(0)
    await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeVisible()
    await expect(homeComposer(page)).toBeInViewport()
  })
})
