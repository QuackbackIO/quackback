/**
 * Two-factor authentication and single sign-on recovery codes. Each test uses
 * its own teammate or portal person; recovery codes are per person (the
 * workspace-wide break-glass check is not asserted here).
 *
 * Journeys: PPL-AUTH-140, 141, 142, 143, 145, 148, 149, 154.
 */
import { personApi, callServerFn } from '../../support/server-fns'
import { supportDb } from '../../support/db'
import { mailTo } from '../../support/mailpit'
import {
  PASSWORD,
  anonApi,
  audits,
  createProvider,
  enrollTwoFactor,
  expect,
  freshTotp,
  getSession,
  portalUser,
  removeProvider,
  setPasswordByReset,
  signIn,
  test,
  totp,
  type TestProvider,
} from '../../product/auth'

const MISMATCH = "Email or recovery code doesn't match. Try another code."

let provider: TestProvider | null = null
test.afterEach(async () => {
  await removeProvider(provider)
  provider = null
})

async function codesFor(api: import('@playwright/test').APIRequestContext): Promise<string[]> {
  const res = await callServerFn<{ codes: string[] }>(api, 'generateRecoveryCodesFn', {})
  expect(res.ok, res.error).toBe(true)
  return res.data.codes
}

test.describe('recovery codes', () => {
  test(
    'PPL-AUTH-140 generate recovery codes, shown once, a new batch replaces the old',
    { tag: '@core' },
    async ({ newTeammate, playwright, browser }) => {
      const mate = await newTeammate({ roleKey: 'admin' })
      const api = await mate.api(playwright)
      const since = new Date()
      const first = await codesFor(api)
      expect(first).toHaveLength(10)
      for (const code of first)
        expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/)
      const rows = await supportDb()<{ code_hash: string }[]>`
        SELECT r.code_hash FROM sso_recovery_code r JOIN "user" u ON u.id = r.user_id
        WHERE u.email = ${mate.email}`
      expect(rows).toHaveLength(10)
      for (const row of rows) for (const code of first) expect(row.code_hash).not.toContain(code)

      const listed = await callServerFn(api, 'listRecoveryCodesFn', undefined, { method: 'GET' })
      expect(listed.ok, listed.error).toBe(true)
      expect(listed.raw).not.toContain(first[0])

      const audit = (await audits('sso.recovery_codes.generated', { email: mate.email, since }))[0]
      expect(audit.metadata).toEqual({ count: 10 })
      expect(audit.target_type).toBe('user')

      // A second batch replaces the unused first one.
      const second = await codesFor(api)
      const after = await supportDb()`SELECT count(*)::int AS n FROM sso_recovery_code r
        JOIN "user" u ON u.id = r.user_id WHERE u.email = ${mate.email}`
      expect(after[0].n).toBe(10)
      expect(second).not.toEqual(first)
      await api.dispose()

      const page = await mate.newPage(browser)
      await page.goto('/admin/settings/security/authentication?tab=sign-in')
      await expect(page.getByText('10 active')).toBeVisible()
    }
  )

  test(
    'PPL-AUTH-141 recovery codes belong to the admin who made them',
    { tag: '@core' },
    async ({ newTeammate, playwright }) => {
      const a = await newTeammate({ roleKey: 'admin' })
      const b = await newTeammate({ roleKey: 'admin' })
      const manager = await newTeammate({ roleKey: 'support_lead' })
      const aApi = await a.api(playwright)
      const codes = await codesFor(aApi)
      await aApi.dispose()

      const bApi = await b.api(playwright)
      const bList = await callServerFn<unknown[] | { codes?: unknown[] }>(
        bApi,
        'listRecoveryCodesFn',
        undefined,
        { method: 'GET' }
      )
      expect(bList.ok, bList.error).toBe(true)
      expect(JSON.stringify(bList.data)).not.toMatch(/"id"/)
      await bApi.dispose()

      const anon = await anonApi(playwright)
      const tried = await callServerFn<{ ok: boolean; error?: string }>(
        anon,
        'consumeRecoveryCodeFn',
        {
          email: b.email,
          code: codes[0],
        }
      )
      expect(tried.data).toEqual({ ok: false, error: 'invalid_credentials' })
      await anon.dispose()

      const mApi = await manager.api(playwright)
      for (const [name, method] of [
        ['generateRecoveryCodesFn', 'POST'],
        ['listRecoveryCodesFn', 'GET'],
      ] as const) {
        const res = await callServerFn(mApi, name, method === 'POST' ? {} : undefined, { method })
        expect(res.ok, name).toBe(false)
        expect(res.error, name).toContain('Access denied')
      }
      await mApi.dispose()
    }
  )

  test(
    'PPL-AUTH-142 sign in with a recovery code when single sign-on is broken',
    { tag: '@core' },
    async ({ newTeammate, playwright, browser, marker }) => {
      const admin = await personApi(playwright, 'admin')
      provider = await createProvider(admin, marker, { enforced: true })
      await admin.dispose()
      const mate = await newTeammate({ roleKey: 'admin' })
      const api = await mate.api(playwright)
      const [code] = await codesFor(api)
      await api.dispose()
      // The teammate's address is at the enforced domain.
      const email = `admin-${Date.now().toString(36)}@${provider.domain}`
      await supportDb()`UPDATE "user" SET email = ${email} WHERE email = ${mate.email}`
      const since = new Date()

      const { visitorContext } = await import('../../product/auth')
      const context = await visitorContext(browser)
      const page = await context.newPage()
      await page.goto('/auth/recovery')
      await expect(page.getByText('Use a recovery code')).toBeVisible()
      await page.locator('#email').fill(email.toUpperCase())
      await page.locator('#code').fill(code.replace(/-/g, '').toLowerCase())
      await page.getByRole('button', { name: 'Sign in' }).click()
      await page.waitForURL((url) => url.pathname.startsWith('/admin'), { timeout: 20_000 })
      expect((await getSession(page.request))?.user.email).toBe(email)

      const used = await supportDb()`SELECT count(*)::int AS n FROM sso_recovery_code r
        JOIN "user" u ON u.id = r.user_id WHERE u.email = ${email} AND r.used_at IS NOT NULL`
      expect(used[0].n).toBe(1)
      const audit = (await audits('sso.recovery_codes.used', { since }))[0]
      expect(audit.actor_email).toBe(email)
      await expect
        .poll(async () => (await mailTo(email)).map((m) => m.Subject))
        .toContainEqual(expect.stringMatching(/recovery code/i))

      // The same code again is a mismatch.
      const again = await anonApi(playwright)
      const res = await callServerFn<{ ok: boolean; error?: string }>(
        again,
        'consumeRecoveryCodeFn',
        {
          email,
          code,
        }
      )
      expect(res.data).toEqual({ ok: false, error: 'invalid_credentials' })
      await again.dispose()
      await context.close()
    }
  )

  test(
    'PPL-AUTH-143 recovery code refusals never reveal whether the email exists',
    { tag: '@core' },
    async ({ newTeammate, playwright, visitor, marker }) => {
      const withCodes = await newTeammate({ roleKey: 'admin' })
      const noCodes = await newTeammate({ roleKey: 'admin' })
      const api = await withCodes.api(playwright)
      await codesFor(api)
      await api.dispose()
      const since = new Date()
      const cases = [
        [`${marker}-nobody@teammates.example`, 'unknown_email'],
        [withCodes.email, 'invalid_code'],
        [noCodes.email, 'invalid_code'],
      ] as const
      for (const [email, reason] of cases) {
        const page = await visitor()
        await page.goto('/auth/recovery')
        await page.locator('#email').fill(email)
        await page.locator('#code').fill('ABCD-EFGH-JKMN')
        await page.getByRole('button', { name: 'Sign in' }).click()
        await expect(page.getByText(MISMATCH)).toBeVisible()
        expect(await getSession(page.request)).toBeNull()
        const rows = await audits('auth.method.blocked', { since })
        const row = rows.find((r) => r.actor_email?.toLowerCase() === email.toLowerCase())
        expect(row, email).toBeTruthy()
        expect(row!.event_outcome).toBe('failure')
        expect(row!.metadata).toMatchObject({ method: 'recovery_code', reason })
      }
    }
  )

  test(
    'PPL-AUTH-145 a removed admin cannot use their recovery codes',
    {
      tag: ['@core', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'Recovery codes are never invalidated when an admin is removed or demoted (lib/server/auth/recovery-codes-status.ts:8, lib/server/functions/recovery-codes-consume.ts:126): removal only sets principal.role to user, so the code still signs them in past Require SSO',
      },
    },
    async ({ newTeammate, playwright }) => {
      const mate = await newTeammate({ roleKey: 'admin' })
      const api = await mate.api(playwright)
      const [code] = await codesFor(api)
      await api.dispose()
      // Removed from the team, as the Team page's remove does.
      await supportDb()`UPDATE principal SET role = 'user'
        WHERE user_id = (SELECT id FROM "user" WHERE email = ${mate.email})`
      const anon = await anonApi(playwright)
      const res = await callServerFn<{ ok: boolean }>(anon, 'consumeRecoveryCodeFn', {
        email: mate.email,
        code,
      })
      await anon.dispose()
      expect(res.data.ok).toBe(false)
    }
  )
})

test.describe('two-factor', () => {
  test(
    'PPL-AUTH-148 turn on two-factor',
    { tag: '@core' },
    async ({ playwright, newApi, marker }) => {
      const person = await portalUser(playwright, `${marker}@customers.example`)
      const api = await newApi()
      expect((await signIn(api, person.email, person.password)).status()).toBe(200)
      const since = new Date()
      // A wrong code first: refused, nothing enrolled.
      const enable = await api.post('/api/auth/two-factor/enable', { data: { password: PASSWORD } })
      expect(enable.status()).toBe(200)
      const { totpURI } = (await enable.json()) as { totpURI: string }
      const wrong = await api.post('/api/auth/two-factor/verify-totp', {
        data: { code: totp(totpURI) === '000000' ? '111111' : '000000' },
      })
      expect(wrong.status()).toBeGreaterThanOrEqual(400)
      const verify = await api.post('/api/auth/two-factor/verify-totp', {
        data: { code: await freshTotp(totpURI) },
      })
      expect(verify.status(), await verify.text()).toBe(200)
      const [user] =
        await supportDb()`SELECT two_factor_enabled FROM "user" WHERE id = ${person.userId}`
      expect(user.two_factor_enabled).toBe(true)
      const [row] =
        await supportDb()`SELECT count(*)::int AS n FROM two_factor WHERE user_id = ${person.userId}`
      expect(row.n).toBe(1)
      await expect
        .poll(
          async () => (await audits('two_factor.enabled', { email: person.email, since })).length
        )
        .toBe(1)
    }
  )

  test(
    'PPL-AUTH-149 an enrolled person is challenged after the password; backup codes work once',
    { tag: '@core' },
    async ({ playwright, newApi, marker }) => {
      const person = await portalUser(playwright, `${marker}@customers.example`)
      const setup = await newApi()
      expect((await signIn(setup, person.email, person.password)).status()).toBe(200)
      const { totpURI, backupCodes } = await enrollTwoFactor(setup, person.password)

      // Password alone gives no session, only the challenge.
      const a = await newApi()
      const first = await signIn(a, person.email, person.password)
      expect(await first.json()).toMatchObject({ twoFactorRedirect: true })
      expect(await getSession(a)).toBeNull()
      const wrong = await a.post('/api/auth/two-factor/verify-totp', {
        data: { code: totp(totpURI) === '000000' ? '111111' : '000000' },
      })
      expect(wrong.status()).toBeGreaterThanOrEqual(400)
      expect(await getSession(a)).toBeNull()
      const right = await a.post('/api/auth/two-factor/verify-totp', {
        data: { code: await freshTotp(totpURI) },
      })
      expect(right.status(), await right.text()).toBe(200)
      expect((await getSession(a))?.user.email).toBe(person.email)

      // A backup code works once.
      const useBackup = async () => {
        const b = await newApi()
        await signIn(b, person.email, person.password)
        const res = await b.post('/api/auth/two-factor/verify-backup-code', {
          data: { code: backupCodes[0] },
        })
        return { status: res.status(), session: await getSession(b) }
      }
      const once = await useBackup()
      expect(once.status).toBe(200)
      expect(once.session?.user.email).toBe(person.email)
      const twice = await useBackup()
      expect(twice.status).toBeGreaterThanOrEqual(400)
      expect(twice.session).toBeNull()
    }
  )

  test(
    "PPL-AUTH-154 an admin resets a teammate's two-factor",
    { tag: '@core' },
    async ({ newTeammate, playwright, newApi }) => {
      const mate = await newTeammate({ roleKey: 'support_lead' })
      await setPasswordByReset(playwright, mate.email)
      const setup = await newApi()
      expect((await signIn(setup, mate.email)).status()).toBe(200)
      await enrollTwoFactor(setup)
      const [{ id: userUuid }] =
        await supportDb()`SELECT id FROM "user" WHERE email = ${mate.email}`

      const since = new Date()
      const admin = await personApi(playwright, 'admin')
      const res = await callServerFn(admin, 'adminResetTwoFactorFn', { userId: mate.userId })
      await admin.dispose()
      expect(res.ok, res.error).toBe(true)
      const [user] = await supportDb()`SELECT two_factor_enabled FROM "user" WHERE id = ${userUuid}`
      expect(user.two_factor_enabled).toBe(false)
      const rows = await supportDb()`SELECT 1 FROM two_factor WHERE user_id = ${userUuid}`
      expect(rows).toHaveLength(0)
      const [audit] = await audits('two_factor.reset_by_admin', { since })
      expect(audit.actor_email).toBe('e2e-support-admin@example.com')

      // The next password sign-in is not challenged.
      const next = await newApi()
      const signin = await signIn(next, mate.email)
      expect(signin.status()).toBe(200)
      expect(JSON.stringify(await signin.json())).not.toContain('twoFactorRedirect')
      expect((await getSession(next))?.user.email).toBe(mate.email)
    }
  )
})
