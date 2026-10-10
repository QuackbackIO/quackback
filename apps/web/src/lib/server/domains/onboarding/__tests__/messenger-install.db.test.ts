/**
 * The install sheet's live status rides the evidence the public widget
 * endpoints record. Read uncached, it turns from waiting to seen the moment
 * the SDK first loads from the customer's own site.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createId } from '@quackback/ids'
import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { settings } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import {
  INSTALL_INSTRUCTIONS_PER_HOUR,
  assertInstallInstructionsAllowed,
  getMessengerInstallStatus,
  readyMessengerForInstall,
} from '../messenger-install'
import { observeExternalWidgetRequest } from '@/lib/server/domains/settings/settings.widget'

const fixture = await createDbTestFixture()

function sdkRequest(origin: string | null): Request {
  const request = new Request('https://acme.quackback.test/api/widget/sdk.js')
  if (origin) request.headers.set('origin', origin)
  return request
}

describe.skipIf(!fixture.available)('Messenger install status (real DB)', () => {
  beforeEach(async () => {
    await fixture.begin()
    await testDb.delete(settings)
    await testDb.insert(settings).values({
      name: 'Acme',
      slug: `acme-${createId('workspace')}`,
      createdAt: new Date(),
      widgetConfig: JSON.stringify({ enabled: false }),
    })
  })
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('waits until the SDK loads from the customer site, then names the site', async () => {
    expect(await getMessengerInstallStatus()).toMatchObject({ seenHost: null, seenAt: null })
    // A load from the workspace's own host (the admin preview) is not the site.
    await observeExternalWidgetRequest(sdkRequest('https://acme.quackback.test'))
    expect((await getMessengerInstallStatus()).seenHost).toBeNull()
    await observeExternalWidgetRequest(sdkRequest('https://www.acme.example'))
    const seen = await getMessengerInstallStatus()
    expect(seen.seenHost).toBe('www.acme.example')
    expect(Date.now() - Date.parse(seen.seenAt!)).toBeLessThan(60_000)
  })

  it('switches Messenger on as the snippet goes out, once', async () => {
    expect((await getMessengerInstallStatus()).enabled).toBe(false)
    await readyMessengerForInstall()
    expect((await getMessengerInstallStatus()).enabled).toBe(true)
    const [before] = await testDb.select({ widgetConfig: settings.widgetConfig }).from(settings)
    await readyMessengerForInstall()
    const [after] = await testDb.select({ widgetConfig: settings.widgetConfig }).from(settings)
    expect(after.widgetConfig).toBe(before.widgetConfig)
  })

  it('limits instruction emails per teammate and refuses customers', async () => {
    const sender = createId('principal')
    for (let i = 0; i < INSTALL_INSTRUCTIONS_PER_HOUR; i++) {
      await assertInstallInstructionsAllowed(sender, 'admin')
    }
    await expect(assertInstallInstructionsAllowed(sender, 'admin')).rejects.toMatchObject({
      code: 'RATE_LIMITED',
    })
    await expect(assertInstallInstructionsAllowed(createId('principal'), 'member')).resolves.toBe(
      undefined
    )
    await expect(
      assertInstallInstructionsAllowed(createId('principal'), 'user')
    ).rejects.toMatchObject({
      code: 'FORBIDDEN',
    })
  })
})
