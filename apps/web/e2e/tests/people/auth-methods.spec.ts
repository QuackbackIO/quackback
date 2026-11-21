/**
 * Sign-in journeys that need a workspace-wide sign-in setting flipped: the
 * email link and code method on, password off, sign-ups closed, required
 * two-factor. Every test here is `@isolated` (the product-isolated job, one
 * worker, its own database) and puts the settings back with
 * `withAuthSettings`.
 *
 * Journeys: PPL-AUTH-05, 10, 13, 24, 31, 32, 37, 38, 39, 40, 42, 73, 76, 78,
 * 150, 151.
 */
import type { Page } from '@playwright/test'
import { ISOLATED, ISOLATED_SKIP } from '../../support/automation'
import { supportDb } from '../../support/db'
import { personApi, callServerFn } from '../../support/server-fns'
import {
  MAGIC_LINK_ON,
  PASSWORD,
  WORKSPACE,
  anonApi,
  audits,
  expect,
  freshTotp,
  getSession,
  portalSignin,
  portalUser,
  signIn,
  signInMail,
  signInMails,
  signUp,
  subjectsTo,
  test,
  tokenOf,
  userRow,
  verificationRow,
  waitForAudit,
  withAuthSettings,
} from '../../product/auth'

test.beforeEach(() => {
  test.skip(!ISOLATED, ISOLATED_SKIP)
})

const CLOSED = { portal_config: { openSignup: false } }

/** Dialog: email, Continue, "Email me a sign-in link instead", "Continue with email". */
async function startCodeSignIn(page: Page, email: string): Promise<void> {
  await page.goto('/?auth=signin')
  const dialog = page.getByRole('dialog')
  await dialog.locator('#inline-email').fill(email)
  await dialog.getByRole('button', { name: /^Continue/ }).click()
  // Password is on too, so the email path is the secondary choice.
  await dialog.getByRole('button', { name: 'Email me a sign-in link instead' }).click()
  await dialog.getByRole('button', { name: 'Continue with email' }).click()
  await expect(dialog.getByLabel('Verification code')).toBeVisible()
}

async function typeCode(page: Page, code: string): Promise<void> {
  await page.getByRole('dialog').getByLabel('Verification code').fill(code)
}

test.describe('email link and code method on', () => {
  test(
    'PPL-AUTH-05 sign in with the 6-digit code',
    { tag: ['@core', '@isolated'] },
    async ({ visitor, customerEmail }) => {
      await withAuthSettings(MAGIC_LINK_ON, async () => {
        const page = await visitor()
        await startCodeSignIn(page, customerEmail)
        const { code, link } = await signInMail(customerEmail)
        await typeCode(page, code)
        await expect(page.getByRole('dialog')).toBeHidden()
        await expect(page.getByRole('button', { name: 'Open account menu' })).toBeVisible()
        expect(new URL(page.url()).pathname).toBe('/')

        const user = await userRow(customerEmail)
        expect(user).toMatchObject({ email_verified: true, name: '' })
        const [principal] =
          await supportDb()`SELECT role, type FROM principal WHERE user_id = ${user!.id}`
        expect(principal).toMatchObject({ role: 'user', type: 'user' })
        const [session] = await supportDb()`SELECT scope FROM session WHERE user_id = ${user!.id}`
        expect(session.scope).toBe('dashboard')
        const audit = await waitForAudit('auth.signin.success', { email: customerEmail })
        expect(audit.metadata).toMatchObject({ method: 'magic-link' })
        // The emailed link is a separate row and still valid.
        expect(await verificationRow(`magic-link:${tokenOf(link)}`)).not.toBeNull()
      })
    }
  )

  test(
    'PPL-AUTH-10 a wrong or expired code is refused with its own message',
    { tag: ['@core', '@isolated'] },
    async ({ visitor, marker }) => {
      await withAuthSettings(MAGIC_LINK_ON, async () => {
        const wrongEmail = `${marker}-wrong@customers.example`
        const page = await visitor()
        await startCodeSignIn(page, wrongEmail)
        const { code } = await signInMail(wrongEmail)
        await typeCode(page, code === '000000' ? '111111' : '000000')
        await expect(
          page.getByText(
            "That code isn't right. Check the email and try again, or send a new code."
          )
        ).toBeVisible()
        expect(await getSession(page.request)).toBeNull()

        const lateEmail = `${marker}-late@customers.example`
        const late = await visitor()
        await startCodeSignIn(late, lateEmail)
        const mail = await signInMail(lateEmail)
        await supportDb()`UPDATE verification SET expires_at = now() - interval '1 minute'
                          WHERE identifier = ${`sign-in-otp-${lateEmail}`}`
        await typeCode(late, mail.code)
        await expect(late.getByText('That code expired. Send a new one.')).toBeVisible()
        expect(await getSession(late.request)).toBeNull()
      })
    }
  )

  test(
    'PPL-AUTH-24 a code refused by the sign-in limit says to wait, not that the code is wrong',
    {
      tag: ['@core', '@isolated', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'A-B6: /sign-in/email-otp spends the same send bucket as the email (hooks.ts:110, :230), and useEmailSignin maps rate_limited to the wrong-code message (components/auth/use-email-signin.ts:113)',
      },
    },
    async ({ browser, playwright, customerEmail }) => {
      await withAuthSettings(MAGIC_LINK_ON, async () => {
        const { clientIp } = await import('../../support/api-client')
        const ip = clientIp()
        const { visitorContext } = await import('../../product/auth')
        const context = await visitorContext(browser, { ip })
        const page = await context.newPage()
        // Send 1 from the dialog, then a resend and one more from the same address.
        await startCodeSignIn(page, customerEmail)
        const api = await anonApi(playwright, { ip })
        expect((await portalSignin(api, customerEmail)).status()).toBe(200)
        expect((await portalSignin(api, customerEmail)).status()).toBe(200)
        await api.dispose()
        const [newest] = await signInMails(customerEmail, 3)
        await typeCode(page, newest.code)
        await expect(page.getByRole('dialog')).toContainText(
          'Too many sign-in attempts. Please wait a moment and try again.'
        )
        await context.close()
      })
    }
  )

  test(
    'PPL-AUTH-13 portal-signin answers the same whether or not an account exists',
    { tag: ['@core', '@isolated'] },
    async ({ playwright, newApi, marker }) => {
      const existing = await portalUser(playwright, `${marker}-member@customers.example`)
      const invited = `${marker}-invited@customers.example`
      const unknown = `${marker}-unknown@customers.example`
      await withAuthSettings({ ...MAGIC_LINK_ON, ...CLOSED }, async () => {
        const admin = await personApi(playwright, 'admin')
        const invite = await callServerFn(admin, 'sendPortalInviteFn', { emails: [invited] })
        expect(invite.ok, invite.error).toBe(true)
        await admin.dispose()

        const bodies: string[] = []
        for (const email of [existing.email, invited, unknown]) {
          const res = await portalSignin(await newApi(), email)
          expect(res.status(), email).toBe(200)
          bodies.push(await res.text())
        }
        expect(new Set(bodies).size).toBe(1)
        expect(JSON.parse(bodies[0])).toEqual({ ok: true })

        await signInMail(existing.email)
        await signInMail(invited)
        await expect
          .poll(async () => subjectsTo(unknown), { timeout: 15_000 })
          .toContain(`About your ${WORKSPACE} sign-in request`)
        expect((await subjectsTo(unknown)).some((s) => /is your code for/.test(s))).toBe(false)
        expect(await verificationRow(`sign-in-otp-${unknown}`)).toBeNull()
        expect(await userRow(unknown)).toBeNull()
      })
    }
  )
})

test.describe('password method off', () => {
  test(
    'PPL-AUTH-31 password method off refuses password sign-in',
    { tag: ['@core', '@isolated'] },
    async ({ playwright, newApi, newTeammate, visitor, marker }) => {
      const person = await portalUser(playwright, `${marker}@customers.example`)
      const mate = await newTeammate({ roleKey: 'admin' })
      const { setPasswordByReset } = await import('../../product/auth')
      await setPasswordByReset(playwright, mate.email)
      await withAuthSettings(
        { auth_config: { 'oauth.password': false, 'oauth.magicLink': true } },
        async () => {
          const portal = await signIn(await newApi(), person.email, person.password)
          expect(portal.status()).toBe(302)
          expect(portal.headers().location).toBe('/?auth=signin&error=password_method_not_allowed')
          const team = await signIn(await newApi(), mate.email, PASSWORD)
          expect(team.status()).toBe(302)
          expect(team.headers().location).toBe(
            '/?auth=signin&callbackUrl=/admin&error=password_method_not_allowed'
          )
          for (const res of [portal, team]) {
            expect(res.headers()['set-cookie'] ?? '').not.toContain('session_token=')
          }
          // The dialog offers no password field at all.
          const page = await visitor()
          await page.goto('/?auth=signin')
          const dialog = page.getByRole('dialog')
          await dialog.locator('#inline-email').fill(person.email)
          await dialog.getByRole('button', { name: /^Continue/ }).click()
          await expect(dialog.getByRole('button', { name: 'Continue with email' })).toBeVisible()
          await expect(dialog.locator('#inline-password')).toHaveCount(0)
        }
      )
    }
  )

  test(
    'PPL-AUTH-32 password method off refuses a password sign-up',
    { tag: ['@core', '@isolated'] },
    async ({ anon, customerEmail }) => {
      await withAuthSettings(
        { auth_config: { 'oauth.password': false, 'oauth.magicLink': true } },
        async () => {
          const res = await signUp(anon, customerEmail)
          expect(res.headers()['set-cookie'] ?? '').not.toContain('session_token=')
          expect(await userRow(customerEmail)).toBeNull()
        }
      )
    }
  )
})

test.describe('sign-ups closed', () => {
  test(
    'PPL-AUTH-37 a new address cannot create an account by password',
    { tag: ['@core', '@isolated'] },
    async ({ anon, customerEmail }) => {
      await withAuthSettings(CLOSED, async () => {
        const res = await signUp(anon, customerEmail)
        expect(res.status()).toBe(302)
        expect(res.headers().location).toBe('/?auth=signin&error=signup_not_allowed')
        expect(await userRow(customerEmail)).toBeNull()
      })
    }
  )

  test(
    'PPL-AUTH-38 the header and dialog stop offering sign-up',
    { tag: ['@core', '@isolated'] },
    async ({ visitor, customerEmail }) => {
      await withAuthSettings(CLOSED, async () => {
        const page = await visitor()
        const signups: string[] = []
        page.on('request', (r) => {
          if (r.url().includes('/api/auth/sign-up')) signups.push(r.url())
        })
        await page.goto('/')
        await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible()
        await expect(page.getByRole('button', { name: 'Sign up' })).toHaveCount(0)

        await page.goto('/?auth=signup')
        const dialog = page.getByRole('dialog')
        await dialog.locator('#inline-email').fill(customerEmail)
        await dialog.getByRole('button', { name: /^Continue/ }).click()
        // The sign-up link lands on the sign-in form: no way to create an account.
        await expect(dialog.getByText('Welcome back')).toBeVisible()
        await expect(dialog.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible()
        await expect(dialog.getByRole('button', { name: 'Create account' })).toHaveCount(0)
        expect(signups).toEqual([])
      })
    }
  )

  test(
    'PPL-AUTH-39 allowed-domain addresses may still create accounts (server)',
    { tag: ['@core', '@isolated'] },
    async ({ newApi, marker }) => {
      const domain = `${marker.replace(/[^a-z0-9]+/g, '-').slice(-30)}.allowed-e2e.com`
      await withAuthSettings(
        { ...CLOSED, portal_config: { openSignup: false, 'access.allowedDomains': [domain] } },
        async () => {
          const a = `a@${domain}`
          const res = await signUp(await newApi(), a)
          expect(res.status(), await res.text()).toBe(200)
          expect(await userRow(a)).not.toBeNull()

          const b = `b@${domain}`
          expect((await portalSignin(await newApi(), b)).status()).toBe(200)
          await signInMail(b)
          expect(await subjectsTo(b)).not.toContain(`About your ${WORKSPACE} sign-in request`)
        }
      )
    }
  )

  test(
    'PPL-AUTH-40 a pending invitation lets that address create its account',
    { tag: ['@core', '@isolated'] },
    async ({ playwright, newApi, marker }) => {
      const invited = `${marker}-x@customers.example`
      const revoked = `${marker}-y@customers.example`
      const expired = `${marker}-z@customers.example`
      await withAuthSettings(CLOSED, async () => {
        const admin = await personApi(playwright, 'admin')
        const sent = await callServerFn(admin, 'sendPortalInviteFn', {
          emails: [invited, revoked, expired],
        })
        expect(sent.ok, sent.error).toBe(true)
        await admin.dispose()
        await supportDb()`UPDATE invitation SET status = 'canceled' WHERE email = ${revoked}`
        await supportDb()`UPDATE invitation SET expires_at = now() - interval '1 minute'
                          WHERE email = ${expired}`

        const ok = await signUp(await newApi(), invited.toUpperCase())
        expect(ok.status(), await ok.text()).toBe(200)
        for (const email of [revoked, expired]) {
          const res = await signUp(await newApi(), email)
          expect(res.headers().location, email).toBe('/?auth=signin&error=signup_not_allowed')
          expect(await userRow(email)).toBeNull()
        }
      })
    }
  )

  test(
    'PPL-AUTH-42 sign-ups closed after the link was sent',
    { tag: ['@nightly', '@isolated'] },
    async ({ anon, visitor, customerEmail }) => {
      expect((await portalSignin(anon, customerEmail)).status()).toBe(200)
      const { link } = await signInMail(customerEmail)
      await withAuthSettings(CLOSED, async () => {
        const page = await visitor()
        await page.goto(link)
        await page.waitForURL(/error=failed_to_create_user/, { timeout: 15_000 })
        await expect(page.locator('[data-sonner-toast]').first()).toContainText(
          "We couldn't create an account for that link."
        )
        expect(await userRow(customerEmail)).toBeNull()
      })
    }
  )
})

test.describe('sign-in settings', () => {
  const SIGN_IN_TAB = '/admin/settings/security/authentication?tab=sign-in'

  test(
    'PPL-AUTH-73 turn password sign-in off and on, audited once per real change',
    { tag: ['@core', '@isolated'] },
    async ({ asPerson, playwright }) => {
      await withAuthSettings({ auth_config: { 'oauth.magicLink': true } }, async () => {
        const since = new Date()
        const admin = await asPerson('admin')
        await admin.goto(SIGN_IN_TAB)
        const password = admin.getByRole('switch', { name: 'Password', exact: true })
        await expect(password).toBeChecked()
        await admin.waitForLoadState('networkidle')
        await password.click()
        await expect(password).not.toBeChecked()
        await expect
          .poll(async () => (await audits('auth.password.disabled', { since })).length)
          .toBe(1)
        const stored = async () => {
          const [row] = await supportDb()`SELECT auth_config FROM settings LIMIT 1`
          return (JSON.parse(String(row.auth_config)) as { oauth: { password?: boolean } }).oauth
            .password
        }
        expect(await stored()).toBe(false)
        await password.click()
        await expect(password).toBeChecked()
        await expect
          .poll(async () => (await audits('auth.password.enabled', { since })).length)
          .toBe(1)
        expect(await stored()).toBe(true)
        const [disabled] = await audits('auth.password.disabled', { since })
        expect(disabled.event_outcome).toBe('success')
        expect(disabled.after_value).toEqual({ password: false })
        expect(disabled.actor_email).toBe('e2e-support-admin@example.com')

        // The same value again writes nothing.
        const api = await personApi(playwright, 'admin')
        const same = await callServerFn(api, 'updateAuthConfigFn', { oauth: { password: true } })
        expect(same.ok, same.error).toBe(true)
        await api.dispose()
        expect(await audits('auth.password.enabled', { since })).toHaveLength(1)
      })
    }
  )

  test(
    'PPL-AUTH-76 the server refuses to switch off the last working method',
    { tag: ['@core', '@isolated'] },
    async ({ playwright }) => {
      await withAuthSettings(
        {
          auth_config: {
            'oauth.password': true,
            'oauth.magicLink': false,
            'oauth.google': false,
            'oauth.github': false,
          },
        },
        async () => {
          const since = new Date()
          const api = await personApi(playwright, 'admin')
          const res = await callServerFn(api, 'updateAuthConfigFn', { oauth: { password: false } })
          await api.dispose()
          expect(res.ok).toBe(false)
          expect(res.code).toBe('LAST_SIGN_IN_METHOD')
          const [row] = await supportDb()`SELECT auth_config FROM settings LIMIT 1`
          expect(JSON.parse(String(row.auth_config)).oauth.password).toBe(true)
          const [audit] = await audits('auth.password.disabled', { since })
          expect(audit.event_outcome).toBe('failure')
          expect(String(audit.metadata?.reason)).toContain('Cannot disable the last')
        }
      )
    }
  )

  test(
    'PPL-AUTH-78 require two-factor, and its cascade when password goes off',
    { tag: ['@core', '@isolated'] },
    async ({ asPerson }) => {
      await withAuthSettings(
        { auth_config: { 'oauth.magicLink': true, 'twoFactor.required': false } },
        async () => {
          const admin = await asPerson('admin')
          await admin.goto(SIGN_IN_TAB)
          const required = admin.getByRole('switch', { name: 'Require two-factor authentication' })
          await admin.waitForLoadState('networkidle')
          await required.click()
          await expect(required).toBeChecked()
          const stored = async () => {
            const [row] = await supportDb()`SELECT auth_config FROM settings LIMIT 1`
            return JSON.parse(String(row.auth_config)) as {
              oauth: { password?: boolean }
              twoFactor?: { required?: boolean }
            }
          }
          await expect.poll(async () => (await stored()).twoFactor?.required).toBe(true)

          await admin.getByRole('switch', { name: 'Password', exact: true }).click()
          await expect.poll(async () => (await stored()).oauth.password).toBe(false)
          expect((await stored()).twoFactor?.required).toBe(false)
          await expect(
            admin.getByText('Turn on Password sign-in to require a second factor.')
          ).toBeVisible()
          await expect(required).toBeDisabled()
        }
      )
    }
  )
})

test.describe('required two-factor', () => {
  test(
    'PPL-AUTH-150 required two-factor walks an un-enrolled person through enrolment',
    { tag: ['@core', '@isolated'] },
    async ({ playwright, visitor, marker }) => {
      const person = await portalUser(playwright, `${marker}@customers.example`)
      await withAuthSettings({ auth_config: { 'twoFactor.required': true } }, async () => {
        const page = await visitor()
        await page.goto('/?auth=signin')
        const dialog = page.getByRole('dialog')
        await dialog.locator('#inline-email').fill(person.email)
        await dialog.getByRole('button', { name: /^Continue/ }).click()
        await dialog.locator('#inline-password').fill(person.password)
        const enable = page.waitForResponse((r) => r.url().includes('/two-factor/enable'))
        await dialog.getByRole('button', { name: 'Sign in', exact: true }).click()
        const { totpURI } = (await (await enable).json()) as { totpURI: string }
        // The authenticator code first, then the backup codes.
        // A full code submits itself.
        await dialog.getByLabel('Authenticator code').fill(await freshTotp(totpURI))
        await dialog.getByRole('button', { name: 'I have saved the codes' }).click()
        await expect(dialog).toBeHidden()
        const [row] =
          await supportDb()`SELECT two_factor_enabled FROM "user" WHERE id = ${person.userId}`
        expect(row.two_factor_enabled).toBe(true)
        expect((await getSession(page.request))?.user.email).toBe(person.email)
      })
    }
  )

  test(
    'PPL-AUTH-151 required two-factor gives an un-enrolled password sign-in no usable session',
    { tag: ['@core', '@isolated'] },
    async ({ playwright, newApi, marker }) => {
      const person = await portalUser(playwright, `${marker}@customers.example`)
      await withAuthSettings({ auth_config: { 'twoFactor.required': true } }, async () => {
        const api = await newApi()
        await signIn(api, person.email, person.password)
        expect(await getSession(api)).toBeNull()
      })
    }
  )
})
