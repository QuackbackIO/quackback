/**
 * The install checks on the setup wizard's last step.
 *
 * Journeys: INT-ON-17.
 *
 * The wizard itself (INT-ON-14, INT-ON-15) and headless setup (INT-ON-16)
 * run once per database, on a workspace with no admin yet; the suite's
 * workspace is already set up, so they are not covered here.
 */
import { test, expect } from '../../support/fixtures'
import { supportEnv } from '../../support/env'
import { callServerFn } from '../../support/server-fns'
import { asPersonApi } from '../../product/platform'

interface InstallChecks {
  email: boolean
  storage: boolean
  address: { ok: boolean; baseUrl: string; visitedOrigin: string | null }
}

test(
  'INT-ON-17 install checks report email, storage and the address in use',
  { tag: '@nightly' },
  async ({ playwright }) => {
    const baseUrl = supportEnv().baseUrl
    await asPersonApi(playwright, 'admin', async (api) => {
      // The suite's install has SMTP (Mailpit), object storage and BASE_URL set.
      const res = await callServerFn<InstallChecks>(api, 'getInstallChecksFn', undefined, {
        method: 'GET',
      })
      expect(res.ok, res.error).toBe(true)
      expect(res.data).toEqual({
        email: true,
        storage: true,
        address: { ok: true, baseUrl, visitedOrigin: null },
      })
    })

    // Settings managers only.
    await asPersonApi(playwright, 'contributor', async (api) => {
      const refused = await callServerFn(api, 'getInstallChecksFn', undefined, { method: 'GET' })
      expect(refused.ok).toBe(false)
      expect(refused.error).toContain("Requires permission 'settings.manage'")
    })
  }
)
