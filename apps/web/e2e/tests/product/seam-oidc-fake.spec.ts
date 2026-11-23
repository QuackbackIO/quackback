/**
 * The OIDC provider fake seam (src/lib/server/e2e-harness/oidc-fake.ts):
 * behind the harness gate the identity-provider URL guard accepts the local
 * https OIDC fake (e2e/support/stand-ins/fake-oidc.ts), so an admin can save a
 * provider pointing at it and a person can sign in through it end to end:
 * discovery, authorize, token, userinfo.
 *
 * An enabled identity provider changes how the whole workspace signs in, so
 * this runs in the product-isolated job (its own database, one worker). The
 * provider has no domains and is removed afterwards.
 */
import { randomBytes } from 'node:crypto'
import { test, expect } from '../../support/fixtures'
import { ISOLATED, ISOLATED_SKIP } from '../../support/automation'
import { supportDb } from '../../support/db'
import { supportEnv } from '../../support/env'
import { fakeOidc } from '../../support/fake-oidc-client'
import { callServerFn, personApi } from '../../support/server-fns'

test(
  'a person signs in through an identity provider on the OIDC fake',
  { tag: ['@isolated', '@core'] },
  async ({ playwright, browser, marker }) => {
    test.skip(!ISOLATED, ISOLATED_SKIP)
    const { baseUrl } = supportEnv()
    const idp = fakeOidc.tenant(marker)
    const clientSecret = `secret-${marker}`
    const email = `${marker}@oidc.test`
    await fakeOidc.script(marker, {
      clientSecret,
      claims: { sub: `sub-${marker}`, email, email_verified: true, name: 'Olive Idp' },
    })

    const admin = await personApi(playwright, 'admin')
    const registrationId = `oidc_e2e${randomBytes(6).toString('hex')}`
    const provider = {
      registrationId,
      label: `IdP ${marker}`.slice(0, 120),
      kind: 'other' as const,
      clientId: `client-${marker}`,
      discoveryUrl: idp.discoveryUrl,
      // A portal person may use a provider that has a public button, or one
      // whose verified domain matches their address; the button is simpler.
      showButton: true,
    }
    let providerId: string | null = null

    try {
      // The admin saves it: the URL guard lets the fake through behind the gate.
      const created = await callServerFn<{ id: string }>(admin, 'upsertIdentityProviderFn', {
        ...provider,
        enabled: false,
      })
      expect(created.ok, created.error).toBe(true)
      providerId = created.data.id
      const secret = await callServerFn(admin, 'setProviderCredentialsFn', {
        id: providerId,
        clientSecret,
      })
      expect(secret.ok, secret.error).toBe(true)
      const enabled = await callServerFn(admin, 'upsertIdentityProviderFn', {
        ...provider,
        id: providerId,
        enabled: true,
      })
      expect(enabled.ok, enabled.error).toBe(true)

      // The person signs in. The browser follows the redirect to the fake,
      // whose certificate is the suite's own: this context accepts it.
      const context = await browser.newContext({ baseURL: baseUrl, ignoreHTTPSErrors: true })
      try {
        const start = await context.request.post('/api/auth/sign-in/social', {
          headers: { origin: baseUrl },
          data: { provider: registrationId, callbackURL: '/', disableRedirect: true },
        })
        expect(start.status(), await start.text()).toBe(200)
        const { url } = (await start.json()) as { url: string }
        expect(url.startsWith(`${idp.issuer}/authorize`)).toBe(true)

        const page = await context.newPage()
        await page.goto(url)
        await page.waitForURL((u) => u.origin === baseUrl && !u.pathname.startsWith('/api/'))

        const session = await context.request.get('/api/auth/get-session')
        expect(session.status()).toBe(200)
        expect(await session.json()).toMatchObject({ user: { email } })
      } finally {
        await context.close()
      }

      const endpoints = (await fakeOidc.requests(marker)).map((r) => `${r.endpoint} ${r.status}`)
      expect(endpoints).toEqual(
        expect.arrayContaining(['discovery 200', 'authorize 302', 'token 200', 'userinfo 200'])
      )
      const [account] = await supportDb()<{ account_id: string }[]>`
        SELECT account_id FROM account WHERE provider_id = ${registrationId}`
      expect(account?.account_id).toBe(`sub-${marker}`)
    } finally {
      if (providerId) {
        // A provider with accounts cannot be removed; this one's account is ours.
        await supportDb()`DELETE FROM account WHERE provider_id = ${registrationId}`
        const removed = await callServerFn(admin, 'deleteIdentityProviderFn', { id: providerId })
        expect(removed.ok, removed.error).toBe(true)
      }
      await admin.dispose()
    }
  }
)
