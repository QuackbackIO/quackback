import { test, expect } from '@playwright/test'
import { setSupportSurfaces } from '../../utils/db-helpers'
import {
  expectLandscapeContainThumb,
  landscapePng,
  pasteImageOn,
  stubConversationImageNetwork,
} from '../../utils/conversation-images'

test.describe('Widget conversation images', { tag: '@smoke' }, () => {
  test.beforeAll(() => {
    setSupportSurfaces(true)
  })

  test('paste and attach land in the tray, then render a contain thumb + zoom', async ({
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
    await expect(page.getByRole('button', { name: 'Enlarge widget-paste.png' })).toBeVisible({
      timeout: 10000,
    })
    await expect(composer.locator('img')).toHaveCount(0)

    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: 'Attach image' }).click(),
    ])
    await chooser.setFiles({
      name: 'widget-clip.png',
      mimeType: 'image/png',
      buffer: landscapePng(),
    })
    await expect(page.getByRole('button', { name: 'Enlarge widget-clip.png' })).toBeVisible({
      timeout: 10000,
    })

    const send = page.getByRole('button', { name: 'Send', exact: true })
    await expect(send).toBeEnabled({ timeout: 10000 })
    await send.click()
    const sent = page
      .getByRole('button', { name: 'Enlarge widget-paste.png' })
      .filter({ has: page.locator('img.object-contain') })
    await expect(sent).toBeVisible({ timeout: 15000 })
    await expectLandscapeContainThumb(sent)
    await sent.click()
    await expect(page.getByRole('dialog').getByRole('button', { name: 'Zoom in' })).toBeVisible()
  })
})
