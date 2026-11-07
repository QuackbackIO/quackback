import { test, expect, type Page, type FrameLocator } from '@playwright/test'

/**
 * The customer portal builder at /design: picking a block and changing it
 * with undo, the menu's own menus and renaming in place, the page switcher,
 * moving a Home block on the grid by keyboard and by mouse, the Theme sheet,
 * words edited in place with a headline's phrase set apart by selection,
 * Ask AI's pane and the device switch.
 *
 * The builder edits one shared draft, so these run in order and each leaves
 * the draft as it found it (undo, or discarding what a failed run left).
 * Needs the Portal designer Labs switch and the v2 design engine on; skipped
 * where the route sends the admin elsewhere.
 */
test.describe.configure({ mode: 'serial' })

const COACH_KEY = 'quackback:designer-coach-menu:'

async function openBuilder(page: Page): Promise<FrameLocator> {
  // The menu's one-time coach mark is taken as seen, so it covers nothing.
  await page.addInitScript((prefix) => {
    const get = Storage.prototype.getItem
    Storage.prototype.getItem = function (key: string) {
      return key.startsWith(prefix) ? '1' : get.call(this, key)
    }
  }, COACH_KEY)
  await page.goto('/design?path=/')
  test.skip(!new URL(page.url()).pathname.startsWith('/design'), 'The builder is not on here')
  const frame = page.frameLocator('iframe[data-designer-canvas]')
  await expect(frame.locator('[data-qb-section^="block-"]').first()).toBeVisible({
    timeout: 30_000,
  })
  // The page takes clicks as the builder's once its designer styles are in.
  await expect(frame.locator('style[data-preview-designer]')).toBeAttached()
  return frame
}

/** Discards what an earlier run may have left in the draft. */
async function startClean(page: Page) {
  const status = page.getByRole('banner', { name: 'Top bar' }).getByRole('button', {
    name: /No changes|not live/,
  })
  if (/No changes/.test(await status.innerText())) return
  await status.click()
  await page.getByRole('menuitem', { name: 'Discard draft' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Discard draft' }).click()
  await expect(status).toHaveText(/No changes/)
}

const undoButton = (page: Page) => page.getByRole('button', { name: 'Undo', exact: true })

/** Picks a block by keyboard, from the top bar's list of the page's blocks. */
async function pickFromList(page: Page, name: string) {
  await page.getByRole('button', { name: 'Blocks on this page' }).click()
  await page.getByRole('menuitem', { name, exact: true }).click()
  await expect(page.getByRole('complementary', { name: 'Properties' })).toBeFocused()
}

const settings = (page: Page) => page.getByRole('complementary', { name: 'Properties' })
const menuItem = (frame: FrameLocator, target: string) =>
  frame.locator(`[data-qb-menu="${target}"]`).filter({ visible: true }).first()

test.beforeEach(async ({ page }) => {
  await openBuilder(page)
  await startClean(page)
})

test('picks a block, changes a setting and undoes it', async ({ page }) => {
  // With nothing picked, the panel shows the page.
  await expect(settings(page)).toHaveAttribute('data-open', '')
  await expect(page.locator('[data-page-panel]')).toBeVisible()
  await pickFromList(page, 'Status')
  await expect(settings(page)).toHaveAttribute('data-open', '')
  // The heading is the words editor, as on the page: plain words, one line.
  const heading = settings(page).getByRole('textbox', { name: 'Heading' })
  const before = (await heading.innerText()).trim()
  await heading.click()
  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.type('E2E status heading')
  await expect(undoButton(page)).not.toHaveAttribute('aria-disabled', 'true')
  await heading.press('Enter')
  await undoButton(page).click()
  await expect(heading).toHaveText(before)
  // Escape goes up a level, Home's block to Blocks, then to the page, and from the page closes it.
  await settings(page).focus()
  await page.keyboard.press('Escape')
  await expect(settings(page).getByRole('heading', { name: 'Blocks', level: 2 })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('[data-page-panel]')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(settings(page)).not.toHaveAttribute('data-open', '')
  await expect(page.getByRole('button', { name: 'Blocks on this page' })).toBeFocused()
})

test('a menu item opens its own menu, where Enter goes to its page', async ({ page }) => {
  const frame = page.frameLocator('iframe[data-designer-canvas]')
  await menuItem(frame, 'roadmap').click()
  const clickMenu = page.locator('[data-menu-click-menu]')
  await expect(clickMenu).toBeVisible()
  await expect(clickMenu.getByRole('menuitem').first()).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: /^Page:\s*Roadmap/ })).toBeVisible()
})

test('a double-clicked menu item is renamed in place, and undo takes it back', async ({ page }) => {
  const frame = page.frameLocator('iframe[data-designer-canvas]')
  const item = menuItem(frame, 'changelog')
  const name = (await item.innerText()).trim()
  await item.dblclick()
  const field = page.getByRole('textbox', { name: /Rename|name/i })
  await expect(field).toBeFocused()
  await field.fill('What is new')
  await page.keyboard.press('Enter')
  await expect(menuItem(frame, 'changelog')).toHaveText('What is new')
  await undoButton(page).click()
  await expect(menuItem(frame, 'changelog')).toHaveText(name)
})

test('a phrase of the headline is set apart by selecting it on the page, and undo takes it back', async ({
  page,
}) => {
  const frame = page.frameLocator('iframe[data-designer-canvas]')
  const headline = frame.locator('[data-qb-words="home.title"]')
  await headline.dblclick()
  const editor = frame.locator('[data-qb-words-editing] [contenteditable="true"]')
  await expect(editor).toBeFocused()
  // Every word starts selected: typing replaces them, then the last word is selected.
  await page.keyboard.type('Help shape what Acme grows into')
  await page.keyboard.press('End')
  for (let i = 0; i < ' into'.length; i++) await page.keyboard.press('ArrowLeft')
  for (let i = 0; i < 'grows'.length; i++) await page.keyboard.press('Shift+ArrowLeft')
  // The format bar offers only the headline's looks.
  const bar = page.getByRole('toolbar', { name: 'Set words apart' })
  await expect(bar.getByRole('button')).toHaveText(['Accent', 'Highlight', 'Lighter'])
  await bar.getByRole('button', { name: 'Accent' }).click()
  await expect(bar.getByRole('button', { name: 'Accent' })).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Enter')
  await expect(headline.locator('[data-qb-accent="colour"]')).toHaveText('grows')
  await expect(headline).toHaveText('Help shape what Acme grows into')
  // The panel shows the same words and mark, with no separate phrase field.
  await expect(page.getByText('Phrase to set apart')).toHaveCount(0)
  await undoButton(page).hover()
  await expect(page.locator('[data-slot="tooltip-content"]')).toHaveText('Undo: Headline: words')
  await undoButton(page).click()
  await expect(headline.locator('[data-qb-accent]')).toHaveCount(0)
  await expect(headline).not.toHaveText('Help shape what Acme grows into')
})

test('the page switcher finds a page by search', async ({ page }) => {
  await page.getByRole('button', { name: /^Page:/ }).click()
  await page.getByPlaceholder(/Search|Find/i).fill('changel')
  // Enter takes the option the search leads with, once the list has caught up.
  await expect(page.locator('[cmdk-item][data-selected=true]')).toHaveText('Changelog')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: /^Page:\s*Changelog/ })).toBeVisible()
})

/** Where a block sits on Home's grid: its first row and column, as the page lays it out. */
async function cellOf(frame: FrameLocator, key: string) {
  return frame.locator(`[data-qb-section="${key}"]`).evaluate((node) => {
    const style = getComputedStyle(node)
    return `${style.gridRowStart}/${style.gridColumnStart}`
  })
}

test('moves a Home block on the grid by keyboard and by mouse, each undone', async ({ page }) => {
  const frame = page.frameLocator('iframe[data-designer-canvas]')
  const block = frame.locator('[data-qb-section^="block-"]').nth(1)
  const key = (await block.getAttribute('data-qb-section'))!
  await block.click()
  const grip = page.locator('[data-drag-handle]')
  await expect(grip).toBeVisible()
  const start = await cellOf(frame, key)

  await grip.focus()
  await page.keyboard.press('ArrowDown')
  await expect.poll(() => cellOf(frame, key)).not.toBe(start)
  await expect(
    page.getByRole('main', { name: 'Page being edited' }).getByRole('status')
  ).toHaveText(/./)
  await undoButton(page).click()
  await expect.poll(() => cellOf(frame, key)).toBe(start)

  // Dragged by its grip onto the last block's place.
  const handle = (await grip.boundingBox())!
  const target = (await frame.locator('[data-qb-section^="block-"]').last().boundingBox())!
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(target.x + 40, target.y + target.height / 2, { steps: 16 })
  await page.mouse.up()
  await expect.poll(() => cellOf(frame, key)).not.toBe(start)
  await undoButton(page).click()
  await expect.poll(() => cellOf(frame, key)).toBe(start)
})

test('Theme opens as a sheet over the properties, with a way back to the block', async ({
  page,
}) => {
  await pickFromList(page, 'Status')
  await page.locator('[data-sheet-button="theme"]').click()
  const sheet = page.getByRole('region', { name: 'Theme' })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByRole('heading', { name: 'Theme' })).toBeFocused()
  await sheet
    .getByRole('navigation', { name: 'Where it is' })
    .getByRole('button', { name: 'Status' })
    .click()
  await expect(sheet).toBeHidden()
  await expect(settings(page).getByRole('heading', { name: 'Status' })).toBeVisible()
  // Escape closes a sheet first, then lets go of the block.
  await page.locator('[data-sheet-button="theme"]').click()
  await expect(page.getByRole('region', { name: 'Theme' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('region', { name: 'Theme' })).toBeHidden()
  await expect(settings(page)).toHaveAttribute('data-open', '')
})

test('Ask AI sits in a pane that sends, collapses, expands and resizes', async ({ page }) => {
  const pane = page.locator('#designer-ai-pane')
  await expect(pane.getByRole('heading', { name: 'Ask AI' })).toBeVisible()

  // An example fills the box; sending shows the request in the conversation.
  // The request to the model is cut off here, so nothing reaches the draft.
  const message = 'E2E request that never reaches the model'
  await page.route('**/_serverFn/**', async (route) => {
    if (route.request().postData()?.includes(message)) return route.abort()
    return route.fallback()
  })
  await pane.getByRole('button', { name: 'Use our green for buttons' }).click()
  const box = pane.getByLabel('Ask Quackback AI')
  await expect(box).toHaveValue('Use our green for buttons')
  await box.fill(message)
  await box.press('Enter')
  await expect(pane.getByRole('log', { name: 'Conversation' })).toContainText(message)

  const edge = pane.getByRole('separator', { name: 'Resize Ask AI' })
  await expect(edge).toHaveAttribute('aria-valuenow', '360')
  await edge.focus()
  await page.keyboard.press('ArrowRight')
  await expect(edge).toHaveAttribute('aria-valuenow', '376')
  // The pane eases to its new width; the edge is grabbed once it is there.
  await expect.poll(async () => (await pane.boundingBox())?.width).toBe(376)
  const grip = (await edge.boundingBox())!
  await page.mouse.move(grip.x + grip.width / 2, grip.y + 200)
  await page.mouse.down()
  await page.mouse.move(grip.x + grip.width / 2 + 60, grip.y + 200, { steps: 6 })
  await page.mouse.up()
  await expect(edge).toHaveAttribute('aria-valuenow', '436')

  await pane.getByRole('button', { name: 'Collapse Ask AI' }).click()
  await expect(pane).toHaveAttribute('data-collapsed', '')
  await expect(pane.getByRole('heading', { name: 'Ask AI' })).toBeHidden()
  await pane.getByRole('button', { name: 'Ask AI' }).click()
  await expect(pane.getByLabel('Ask Quackback AI')).toBeFocused()
  // "/" opens it from anywhere outside a field.
  await pane.getByRole('button', { name: 'Collapse Ask AI' }).click()
  await page.getByRole('heading', { level: 1 }).evaluate((node) => (node as HTMLElement).blur())
  await page.locator('body').press('/')
  await expect(pane.getByLabel('Ask Quackback AI')).toBeFocused()
})

test('the device switch draws the page at tablet and phone widths', async ({ page }) => {
  const canvas = page.locator('iframe[data-designer-canvas]')
  await page.getByRole('radio', { name: 'Tablet' }).click()
  await expect(page.getByText('Tablet, 768 px wide')).toBeVisible()
  await expect(canvas).toHaveCSS('width', '768px')
  await page.getByRole('radio', { name: 'Phone' }).click()
  await expect(page.getByText('Phone, 390 px wide')).toBeVisible()
  await expect(canvas).toHaveCSS('width', '390px')
  // A block picked on a phone keeps its chip inside the canvas, with the phone note.
  const frame = page.frameLocator('iframe[data-designer-canvas]')
  await frame.locator('[data-qb-section^="block-"]').nth(1).click()
  await expect(settings(page)).toContainText('On phones, blocks stack in reading order.')
  const chip = await page.getByRole('toolbar', { name: /picked/ }).boundingBox()
  const frameBox = await canvas.boundingBox()
  expect(chip!.x).toBeGreaterThanOrEqual(frameBox!.x)
  expect(chip!.x + chip!.width).toBeLessThanOrEqual(frameBox!.x + frameBox!.width * 1.0001)
  await page.getByRole('radio', { name: 'Desktop' }).click()
  await expect(canvas).toHaveCSS('width', '1280px')
})

test('a Suggested card in Add drags onto Home, and undo takes it off', async ({ page }) => {
  const frame = page.frameLocator('iframe[data-designer-canvas]')
  const blocks = frame.locator('[data-qb-section^="block-"]')
  await expect(blocks.first()).toBeVisible()
  const before = await blocks.count()
  await page.locator('[data-sheet-button="add"]').click()
  const suggested = page.getByRole('region', { name: 'Suggested' })
  test.skip((await suggested.count()) === 0, 'Home already shows every part that is on')
  // The sheet slides in; the card is grabbed once it has settled.
  const first = suggested.getByRole('button').first()
  let settled = -1
  await expect
    .poll(async () => {
      const x = (await first.boundingBox())?.x ?? -2
      const still = x === settled
      settled = x
      return still
    })
    .toBe(true)
  const card = (await first.boundingBox())!
  const target = (await blocks.first().boundingBox())!
  await page.mouse.move(card.x + card.width / 2, card.y + card.height / 2)
  await page.mouse.down()
  await page.mouse.move(target.x + target.width / 2, target.y + target.height + 8, { steps: 16 })
  await page.mouse.up()
  await expect(blocks).toHaveCount(before + 1)
  // The added block is picked, so its settings open.
  await expect(settings(page)).toHaveAttribute('data-open', '')
  await undoButton(page).click()
  await expect(blocks).toHaveCount(before)
})

test('focusing a field deep in the settings scrolls only the panel, never the page', async ({
  page,
}) => {
  await pickFromList(page, 'Hero')
  await settings(page).locator('input').last().focus()
  const scrolled = await page.evaluate(() => ({
    page: window.scrollY,
    panel: document.getElementById('designer-settings')!.scrollTop,
  }))
  expect(scrolled).toEqual({ page: 0, panel: 0 })
  await expect(settings(page).getByRole('heading', { name: 'Hero' })).toBeInViewport()
})
