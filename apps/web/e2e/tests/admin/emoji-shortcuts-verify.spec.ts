import { mkdirSync } from 'node:fs'
import { test, expect } from '@playwright/test'
import { setSupportSurfaces, seedConversation } from '../../utils/db-helpers'

const SHOT_DIR = '/tmp/qb-emoji-verify'

test.describe('Emoji shortcut visual verification', () => {
  test.use({ viewport: { width: 1440, height: 900 } })
  test.setTimeout(90_000)

  test.beforeAll(() => {
    mkdirSync(SHOT_DIR, { recursive: true })
    setSupportSurfaces(true)
  })

  test('captures typeahead, Tab insert, sent glyph, recents, smile grid, slash', async ({
    page,
  }) => {
    const seeded = seedConversation(`Emoji verify ${Date.now()}`)
    await page.goto('/admin/inbox')

    const row = page.getByText(seeded.messages[1]).first()
    await expect(row).toBeVisible({ timeout: 15000 })
    await expect(async () => {
      await row.click()
      await expect(page).toHaveURL(new RegExp(`i=${seeded.conversationId}`), { timeout: 2000 })
    }).toPass({ timeout: 15000 })

    const composer = page.locator('.ProseMirror[contenteditable="true"]').first()
    await composer.click()
    await page.keyboard.type('Fingers crossed ')
    await page.keyboard.type(':')
    const emojiMenu = page.locator('[data-emoji-picker]')
    await expect(emojiMenu).toBeVisible({ timeout: 5000 })
    await page.screenshot({ path: `${SHOT_DIR}/01-bare-colon-popular.png` })
    await emojiMenu.screenshot({ path: `${SHOT_DIR}/01b-bare-colon-menu.png` })

    await page.keyboard.type('finger')
    await expect(emojiMenu).toBeVisible()
    await expect(emojiMenu.locator('[data-emoji-shortcode="crossed_fingers"]')).toBeVisible({
      timeout: 5000,
    })
    await expect(emojiMenu.locator('[data-query-match]').first()).toHaveText('finger')
    await expect
      .poll(async () => {
        const menuBox = await emojiMenu.boundingBox()
        const sendBox = await page.getByRole('button', { name: 'Send reply' }).boundingBox()
        return Boolean(menuBox && sendBox && menuBox.y + menuBox.height < sendBox.y)
      })
      .toBe(true)
    await page.screenshot({ path: `${SHOT_DIR}/02-finger-typeahead.png` })
    await emojiMenu.screenshot({ path: `${SHOT_DIR}/02b-finger-menu.png` })

    await page.keyboard.press('Tab')
    await expect(emojiMenu).toBeHidden({ timeout: 5000 })
    await expect(composer).toContainText('🤞')
    await page.screenshot({ path: `${SHOT_DIR}/03-tab-inserted-glyph.png` })

    await page.getByRole('button', { name: 'Send reply' }).click()
    const sentBubble = page
      .locator('[data-inbox-thread], main, [class*="thread"]')
      .locator('text=Fingers crossed')
      .last()
    await expect(page.getByText('Fingers crossed').last()).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('Fingers crossed').last()).toContainText('🤞')
    await page.screenshot({ path: `${SHOT_DIR}/04-sent-message-glyph.png` })
    await sentBubble.screenshot({ path: `${SHOT_DIR}/04b-sent-bubble.png` }).catch(() => {})

    await composer.click()
    await page.keyboard.type(':')
    await expect(emojiMenu).toBeVisible({ timeout: 5000 })
    await expect(emojiMenu.getByText('Recent', { exact: true })).toBeVisible({ timeout: 5000 })
    await page.screenshot({ path: `${SHOT_DIR}/05-bare-colon-recent.png` })
    await emojiMenu.screenshot({ path: `${SHOT_DIR}/05b-recent-menu.png` })
    await page.keyboard.press('Escape')

    await page.getByRole('button', { name: 'Insert emoji' }).click()
    const smilePanel = page.getByRole('dialog').or(page.locator('[data-slot="popover-content"]'))
    await expect(smilePanel.getByText('Recent', { exact: true })).toBeVisible({ timeout: 5000 })
    await expect(smilePanel.getByText('Popular', { exact: true })).toBeVisible()
    await expect(smilePanel.getByText('🤞').first()).toBeVisible()
    await page.screenshot({ path: `${SHOT_DIR}/06-smile-grid-recent-popular.png` })
    await smilePanel.first().screenshot({ path: `${SHOT_DIR}/06b-smile-panel.png` })
    await page.keyboard.press('Escape')

    await composer.click()
    await page.keyboard.type('/')
    await expect(page.getByRole('button', { name: 'Bullet List' })).toBeVisible({ timeout: 5000 })
    const slashPopup = page.locator('[data-editor-suggestion]').last()
    await expect
      .poll(async () => {
        const slashBox = await slashPopup.boundingBox()
        const sendAfterSlash = await page.getByRole('button', { name: 'Send reply' }).boundingBox()
        return Boolean(
          slashBox && sendAfterSlash && slashBox.y + slashBox.height < sendAfterSlash.y
        )
      })
      .toBe(true)
    await page.screenshot({ path: `${SHOT_DIR}/07-slash-menu.png` })
    await page.keyboard.press('Escape')

    await composer.click()
    await page.keyboard.type('Typed shortcode ')
    await page.keyboard.type(':crossed_fingers:')
    await expect(composer).toContainText('🤞')
    await page.getByRole('button', { name: 'Send reply' }).click()
    await expect(page.getByText('Typed shortcode').first()).toBeVisible({ timeout: 10000 })
    await page.screenshot({ path: `${SHOT_DIR}/08-typed-shortcode-sent.png` })
  })
})
