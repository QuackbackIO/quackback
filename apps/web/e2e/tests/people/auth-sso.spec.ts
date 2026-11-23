/**
 * Single sign-on at our own door: identity providers created through the
 * admin's server functions, verified domains seeded directly (DNS is not in
 * the suite) on a domain only the test uses, and the sign-in endpoints that
 * must respect "Require SSO". No identity provider answers the providers'
 * endpoints, so nothing here completes a provider sign-in.
 *
 * Journeys: PPL-AUTH-107, 108, 109, 110.
 */
import { personApi, callServerFn } from '../../support/server-fns'
import { supportDb } from '../../support/db'
import {
  createProvider,
  expect,
  removeProvider,
  signIn,
  signUp,
  subjectsTo,
  test,
  testDomain,
  userRow,
  type TestProvider,
} from '../../product/auth'

const SSO_REQUIRED = '/?auth=signin&callbackUrl=/admin&error=verified_domain_requires_sso'

let provider: TestProvider | null = null
test.afterEach(async () => {
  await removeProvider(provider)
  provider = null
})

test(
  'PPL-AUTH-109 Require SSO blocks password sign-in and sign-up for the domain',
  { tag: '@smoke' },
  async ({ playwright, anon, newApi, marker }) => {
    const admin = await personApi(playwright, 'admin')
    provider = await createProvider(admin, marker, { enforced: true })
    await admin.dispose()

    const email = `someone-${Date.now().toString(36)}@${provider.domain}`
    const signin = await signIn(anon, email, 'any-password-123')
    expect(signin.status()).toBe(302)
    expect(signin.headers().location).toBe(SSO_REQUIRED)
    expect(signin.headers()['set-cookie'] ?? '').not.toContain('session_token=')

    const signup = await signUp(await newApi(), email, 'any-password-123')
    expect(signup.status()).toBe(302)
    expect(signup.headers().location).toBe(SSO_REQUIRED)
    expect(await userRow(email)).toBeNull()
  }
)

test(
  'PPL-AUTH-110 Require SSO blocks magic link and email code sends for the domain',
  { tag: '@core' },
  async ({ playwright, anon, newApi, marker }) => {
    const admin = await personApi(playwright, 'admin')
    provider = await createProvider(admin, marker, { enforced: true })
    await admin.dispose()

    const email = `someone@${provider.domain}`
    const link = await anon.post('/api/auth/sign-in/magic-link', {
      data: { email, callbackURL: '/' },
      maxRedirects: 0,
    })
    expect(link.status()).toBe(302)
    expect(link.headers().location).toBe(SSO_REQUIRED)
    const otp = await (
      await newApi()
    ).post('/api/auth/email-otp/send-verification-otp', {
      data: { email, type: 'sign-in' },
      maxRedirects: 0,
    })
    expect(otp.status()).toBe(302)
    expect(otp.headers().location).toBe(SSO_REQUIRED)

    await new Promise((r) => setTimeout(r, 2_000))
    expect(await subjectsTo(email)).toEqual([])
    const rows = await supportDb()`SELECT identifier FROM verification
                                   WHERE value LIKE ${`%${email}%`} OR identifier LIKE ${`%${email}%`}`
    expect(rows).toEqual([])
  }
)

test(
  'PPL-AUTH-108 email-first routing sends an address to its domain provider',
  { tag: '@core' },
  async ({ playwright, anon, marker }) => {
    const admin = await personApi(playwright, 'admin')
    provider = await createProvider(admin, marker, { enforced: true })
    const open = await createProvider(admin, `${marker}-open`, { enforced: false })
    const dead = await createProvider(admin, `${marker}-dead`, { enforced: true, secret: false })
    await admin.dispose()
    try {
      const lookup = async (email: string) => {
        const res = await callServerFn<Record<string, unknown>>(anon, 'lookupAuthMethodsFn', {
          email,
        })
        expect(res.ok, res.error).toBe(true)
        return res.data
      }
      // 1. Enforced: straight to the provider.
      expect(await lookup(`a@${provider.domain}`)).toMatchObject({
        kind: 'sso-redirect',
        providerId: provider.registrationId,
      })
      // 2. Verified, not enforced: the provider is the default, methods stay.
      expect(await lookup(`a@${open.domain}`)).toMatchObject({
        kind: 'sso-default',
        providerId: open.registrationId,
      })
      // 3. No verified domain, 4. a subdomain, 5. a provider that cannot work.
      for (const email of [
        `a@${testDomain(`${marker}-none`)}`,
        `a@eu.${provider.domain}`,
        `a@${dead.domain}`,
      ]) {
        const answer = await lookup(email)
        expect(answer.kind, email).toBe('methods')
        expect(JSON.stringify(answer)).not.toContain('domains')
      }
    } finally {
      await removeProvider(open)
      await removeProvider(dead)
    }
  }
)

test(
  'PPL-AUTH-107 enforcement lifts when the owning provider stops working',
  { tag: '@core' },
  async ({ playwright, anon, newApi, marker }) => {
    const admin = await personApi(playwright, 'admin')
    provider = await createProvider(admin, marker, { enforced: true })
    const email = `someone@${provider.domain}`
    expect((await signIn(anon, email, 'any-password-123')).headers().location).toBe(SSO_REQUIRED)

    await admin.dispose()
    // The provider stops working (switched off).
    await supportDb()`UPDATE identity_provider SET enabled = false WHERE id = ${provider.uuid}`
    await supportDb()`UPDATE settings SET auth_config_version = auth_config_version + 1`

    // Password works again for that address (a wrong password, not an SSO refusal).
    const res = await signIn(await newApi(), email, 'any-password-123')
    expect(res.status()).toBe(401)
    const lookup = await callServerFn<{ kind: string }>(await newApi(), 'lookupAuthMethodsFn', {
      email,
    })
    expect(lookup.data.kind).toBe('methods')
  }
)
