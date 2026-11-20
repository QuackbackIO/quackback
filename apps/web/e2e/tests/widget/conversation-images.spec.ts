import { test, expect } from '@playwright/test'
import { setSupportSurfaces } from '../../utils/db-helpers'
import {
  expectLoadedImage,
  expectSquareImageTile,
  landscapePng,
  pasteImageOn,
  stubConversationImageNetwork,
} from '../../utils/conversation-images'

test.describe('Widget conversation images', () => {
  test.beforeAll(() => {
    setSupportSurfaces(true)
  })

  test('paste and attach land in the tray, then render image tiles that open the viewer', async ({
    page,
  }) => {
    test.setTimeout(60_000)
    const png = await stubConversationImageNetwork(page)
    await page.goto('/widget')
    await page.getByRole('button', { name: 'Messages', exact: true }).click()
    await expect(page.getByText('No conversations yet')).toBeVisible({ timeout: 10000 })
    await page.getByRole('button', { name: /Ask a question/ }).click()

    const composer = page.locator('.ProseMirror[contenteditable="true"]')
    await expect(composer).toBeVisible({ timeout: 10000 })

    const composerBox = page.locator('.rounded-2xl.border').filter({ has: composer })
    await pasteImageOn(composerBox, png, 'widget-paste.png')
    await expect(page.getByRole('button', { name: 'Open widget-paste.png' })).toBeVisible({
      timeout: 10000,
    })
    await expect(composer.locator('img')).toHaveCount(0)

    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: 'Attach files' }).click(),
    ])
    await chooser.setFiles({
      name: 'widget-clip.png',
      mimeType: 'image/png',
      buffer: landscapePng(),
    })
    await expect(page.getByRole('button', { name: 'Open widget-clip.png' })).toBeVisible({
      timeout: 10000,
    })

    const send = page.getByRole('button', { name: 'Send', exact: true })
    await expect(send).toBeEnabled({ timeout: 10000 })
    await send.click()
    const thread = page.locator('[data-message-id]')
    const sent = thread.getByRole('button', { name: 'Open widget-paste.png' })
    await expect(sent).toBeVisible({ timeout: 15000 })
    await expectSquareImageTile(sent)
    await expectSquareImageTile(thread.getByRole('button', { name: 'Open widget-clip.png' }))
    await sent.click()
    // The widget's viewer is the compact sheet: no zoom buttons, but it opens
    // on the image that was clicked.
    const viewer = page.getByRole('dialog')
    await expect(viewer.getByText('widget-paste.png', { exact: true })).toBeVisible()
    await expectLoadedImage(viewer.locator('img').first())
  })
})
