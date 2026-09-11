import { test, expect } from '@playwright/test'
import {
  setSupportSurfaces,
  seedConversation,
  type SeededConversation,
} from '../../utils/db-helpers'
import {
  CHANGELOG_PNG,
  LEGACY_WIDE_PNG,
  expectLandscapeContainThumb,
  landscapePng,
  pasteImageOn,
  stubConversationImageNetwork,
} from '../../utils/conversation-images'

test.describe('Admin conversation images', { tag: '@smoke' }, () => {
  test.use({ viewport: { width: 1920, height: 1080 } })
  let seeded: SeededConversation

  test.beforeAll(() => {
    setSupportSurfaces(true)
    seeded = seedConversation(`E2E conversation images ${Date.now()}`, undefined, {
      legacyImage: true,
    })
  })

  test('lifts a smashed inline screenshot to a contain thumb and zoom modal', async ({ page }) => {
    test.setTimeout(60_000)
    await stubConversationImageNetwork(page)
    await page.goto('/admin/inbox')

    const row = page.getByText(seeded.messages[1]).first()
    await expect(row).toBeVisible({ timeout: 15000 })
    await expect(async () => {
      await row.click()
      await expect(page).toHaveURL(new RegExp(`i=${seeded.conversationId}`), { timeout: 2000 })
    }).toPass({ timeout: 15000 })

    const legacy = page.getByRole('button', { name: `Enlarge ${LEGACY_WIDE_PNG}` })
    await expect(legacy).toBeVisible({ timeout: 10000 })
    await expectLandscapeContainThumb(legacy)
    await expect(page.locator(`img[width="500"][height="500"]`)).toHaveCount(0)

    await legacy.click()
    const dialog = page.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await expect(dialog.getByRole('img', { name: LEGACY_WIDE_PNG })).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'Zoom in' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })

  test('paste and paperclip stage the tray, then send a contain thumb', async ({ page }) => {
    test.setTimeout(60_000)
    const png = await stubConversationImageNetwork(page)
    await page.goto(`/admin/inbox?i=${seeded.conversationId}`)
    await expect(page.getByText(seeded.messages[0]).first()).toBeVisible({ timeout: 15000 })

    const composer = page.locator('[data-inbox-composer]')
    await expect(composer).toBeVisible()
    await pasteImageOn(composer, png, 'pasted-shot.png')

    const trayThumb = composer.getByRole('button', { name: 'Enlarge pasted-shot.png' })
    await expect(trayThumb).toBeVisible({ timeout: 10000 })
    await expect(composer.locator('.ProseMirror img')).toHaveCount(0)

    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: 'Attach image' }).click(),
    ])
    await chooser.setFiles({
      name: 'paperclip.png',
      mimeType: 'image/png',
      buffer: landscapePng(),
    })
    await expect(composer.getByRole('button', { name: 'Enlarge paperclip.png' })).toBeVisible({
      timeout: 10000,
    })

    await page.getByRole('button', { name: 'Send reply' }).click()
    const sent = page
      .getByRole('button', { name: 'Enlarge pasted-shot.png' })
      .filter({ has: page.locator('img.object-contain') })
    await expect(sent).toBeVisible({ timeout: 15000 })
    await expectLandscapeContainThumb(sent)
    await sent.click()
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Zoom in' })).toBeVisible()
  })
})

test.describe('Changelog images stay inline', () => {
  test('paste in a changelog entry inserts an editor image, not a chat tray', async ({ page }) => {
    test.setTimeout(45_000)
    const png = await stubConversationImageNetwork(page)
    await page.goto('/admin/changelog')
    const newEntry = page.getByRole('button', { name: /new entry/i })
    await expect(newEntry.first()).toBeVisible({ timeout: 15000 })
    const dialog = page.getByRole('dialog')
    await expect(async () => {
      if (!(await dialog.isVisible().catch(() => false))) {
        await newEntry.first().click()
      }
      await expect(dialog).toBeVisible({ timeout: 2000 })
    }).toPass({ timeout: 15000 })

    const editor = dialog.locator('.ProseMirror[contenteditable="true"]')
    await editor.click()
    await pasteImageOn(editor, png, 'changelog-shot.png')

    await expect(editor.locator(`img[src*="${CHANGELOG_PNG}"]`)).toBeVisible({ timeout: 10000 })
    await expect(dialog.getByRole('button', { name: 'Remove attachment' })).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: /Enlarge / })).toHaveCount(0)
  })
})
