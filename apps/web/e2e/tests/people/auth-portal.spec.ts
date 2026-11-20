/**
 * Portal sign-in, sign-up and password journeys on the workspace's default
 * sign-in settings (password on, sign-ups open). Every request and browser
 * context carries its own `x-e2e-client-ip`, so the per-address limiters and
 * the library's in-memory per-IP limits never meet another test's budget.
 * PPL-AUTH-16 is the exception: it switches the email link method off, so it
 * is `@isolated` and puts the setting back with `withAuthSettings`.
 *
 * Journeys: PPL-AUTH-01, 02, 04, 06, 07, 08, 09, 12, 14, 15, 16, 20, 21, 22,
 * 25, 27, 29, 30, 33, 34, 35, 41, 51, 52, 53, 55, 56, 57, 58.
 */
import { ISOLATED, ISOLATED_SKIP } from '../../support/automation'
import { pollFor, supportDb } from '../../support/db'
import { getMail, linksIn, mailTo } from '../../support/mailpit'
import {
  MAGIC_LINK_ON,
  PASSWORD,
  WORKSPACE,
  audits,
  baseUrl,
  expect,
  getSession,
  portalSignin,
  portalUser,
  resetLink,
  sessionsOf,
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

/** Sign in through the dialog by password, from the portal root. */
async function dialogPasswordSignIn(
  page: import('@playwright/test').Page,
  email: string,
  password: string
) {
  await page.goto('/?auth=signin')
  await page.locator('#inline-email').fill(email)
  await page.getByRole('button', { name: /^Continue/ }).click()
  await page.locator('#inline-password').fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
}

test.describe('entry and links', () => {
  test(
    'PPL-AUTH-01 sign-in entry URLs open the dialog with the destination carried',
    { tag: '@core' },
    async ({ anon, visitor }) => {
      for (const [path, location] of [
        ['/auth/login?callbackUrl=/b/x', '/?auth=signin&callbackUrl=%2Fb%2Fx'],
        ['/auth/signup?callbackUrl=/roadmap', '/?auth=signup&callbackUrl=%2Froadmap'],
        ['/admin/login', '/?auth=signin&callbackUrl=%2Fadmin'],
        ['/admin/signup', '/?auth=signup&callbackUrl=%2Fadmin'],
        [
          '/auth/login?callbackUrl=/x&error=INVALID_TOKEN',
          '/?auth=signin&callbackUrl=%2Fx&error=INVALID_TOKEN',
        ],
      ] as const) {
        const res = await anon.get(path, { maxRedirects: 0 })
        expect(res.status(), path).toBe(307)
        expect(res.headers().location, path).toBe(location)
      }

      // A team destination opens the dialog with the team copy.
      const page = await visitor()
      await page.goto('/admin/login')
      await expect(page).toHaveURL(/\?auth=signin&callbackUrl=%2Fadmin/)
      const dialog = page.getByRole('dialog')
      await expect(dialog.getByText(`Sign in to ${WORKSPACE} admin`)).toBeVisible()
      await expect(dialog.locator('#inline-email')).toBeVisible()
    }
  )

  test('PPL-AUTH-02 unsafe callback URLs are dropped', { tag: '@core' }, async ({ anon }) => {
    for (const unsafe of [
      'https://evil.example/x',
      '//evil.example',
      '/\\evil.example',
      '/\t/evil.example',
      '/x\ny',
    ]) {
      const q = encodeURIComponent(unsafe)
      const login = await anon.get(`/auth/login?callbackUrl=${q}`, { maxRedirects: 0 })
      expect(login.headers().location, unsafe).toBe('/?auth=signin&callbackUrl=%2F')
      const admin = await anon.get(`/admin/login?callbackUrl=${q}`, { maxRedirects: 0 })
      expect(admin.headers().location, unsafe).toBe('/?auth=signin&callbackUrl=%2Fadmin')
    }
  })

  test(
    'PPL-AUTH-08 verify page without a token says the link is invalid',
    { tag: '@nightly' },
    async ({ visitor }) => {
      const page = await visitor()
      const verifyCalls: string[] = []
      page.on('request', (r) => {
        if (r.url().includes('/api/auth/magic-link/verify')) verifyCalls.push(r.url())
      })
      await page.goto('/verify-magic-link')
      await expect(page.getByText('Invalid link', { exact: true })).toBeVisible()
      await expect(page.getByText(/This verification link is invalid or incomplete/)).toBeVisible()
      await expect(page.getByRole('button', { name: 'Go to Home' })).toBeVisible()
      await page.waitForTimeout(1_000)
      expect(page.url()).toContain('/verify-magic-link')
      expect(verifyCalls).toEqual([])
    }
  )
})

test.describe('email link and code', () => {
  test(
    'PPL-AUTH-04 one sign-in email carries a link and a 6-digit code',
    { tag: '@core' },
    async ({ anon, customerEmail }) => {
      const res = await portalSignin(anon, customerEmail, '/roadmap')
      expect(res.status()).toBe(200)
      expect(await res.json()).toEqual({ ok: true })

      const mail = await signInMail(customerEmail)
      expect(mail.message.Subject).toMatch(new RegExp(`^\\d{6} is your code for ${WORKSPACE}$`))
      expect(mail.message.To.map((t) => t.Address)).toEqual([customerEmail])
      const link = new URL(mail.link)
      expect(link.origin).toBe(baseUrl())
      expect(link.pathname).toBe('/verify-magic-link')
      expect(link.searchParams.get('callbackURL')).toBe(`${baseUrl()}/roadmap`)
      expect(link.searchParams.get('errorCallbackURL')).toBe(`${baseUrl()}/auth/login`)
      expect(mail.message.Text).toContain(mail.code)
      expect(mail.message.Text).toContain('The link and code expire in 10 minutes.')

      // Both halves are stored, the link for ten minutes.
      const token = tokenOf(mail.link)
      const [linkRow] = await supportDb()<{ value: string; minutes: number }[]>`
        SELECT value, extract(epoch FROM expires_at - now()) / 60 AS minutes
        FROM verification WHERE identifier = ${`magic-link:${token}`}`
      expect(JSON.parse(linkRow.value)).toEqual({ type: 'magic-link', email: customerEmail })
      expect(Number(linkRow.minutes)).toBeGreaterThan(9)
      expect(Number(linkRow.minutes)).toBeLessThanOrEqual(10)
      const otp = await verificationRow(`sign-in-otp-${customerEmail}`)
      expect(otp?.value.split(':')[0]).toBe(mail.code)

      // The app logged the send; no account exists until the link or code is used.
      // The log row is written after the mail goes out, so it can trail the
      // mailbox: wait for it.
      const log = await pollFor('the sign-in email log row', async () => {
        const [row] = await supportDb()<{ status: string; direction: string }[]>`
          SELECT status, direction FROM email_log WHERE lower(address) = ${customerEmail}`
        return row ?? null
      })
      expect(log).toMatchObject({ status: 'sent', direction: 'outbound' })
      expect(await userRow(customerEmail)).toBeNull()
    }
  )

  test(
    'PPL-AUTH-06 sign in with the emailed link',
    { tag: '@smoke' },
    async ({ anon, visitor, customerEmail }) => {
      expect((await portalSignin(anon, customerEmail, '/roadmap')).status()).toBe(200)
      const { link } = await signInMail(customerEmail)

      const page = await visitor()
      await page.goto(link)
      await page.waitForURL(`${baseUrl()}/roadmap`, { timeout: 15_000 })
      await expect(page.getByRole('button', { name: 'Open account menu' })).toBeVisible()
      expect((await getSession(page.request))?.user.email).toBe(customerEmail)

      const user = await userRow(customerEmail)
      expect(user?.email_verified).toBe(true)
      expect(await verificationRow(`magic-link:${tokenOf(link)}`)).toBeNull()
    }
  )

  test(
    'PPL-AUTH-07 a link scanner cannot spend the sign-in link',
    { tag: '@core' },
    async ({ anon, newApi, visitor, customerEmail }) => {
      expect((await portalSignin(anon, customerEmail, '/roadmap')).status()).toBe(200)
      const { link } = await signInMail(customerEmail)
      const token = tokenOf(link)

      // A plain GET with no JavaScript, as a mail scanner makes.
      const scanner = await newApi()
      const res = await scanner.get(link)
      expect(res.status()).toBe(200)
      expect(res.headers()['content-type']).toContain('text/html')
      expect(await verificationRow(`magic-link:${token}`)).not.toBeNull()
      expect(await getSession(scanner)).toBeNull()

      const page = await visitor()
      await page.goto(link)
      await page.waitForURL(`${baseUrl()}/roadmap`, { timeout: 15_000 })
      expect((await getSession(page.request))?.user.email).toBe(customerEmail)
    }
  )

  test(
    'PPL-AUTH-09 a reused or expired sign-in link says it expired',
    {
      tag: ['@core', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'A-B1: the library redirects with error=INVALID_TOKEN (uppercase); the toast map only knows lowercase codes, so the generic "Sign-in failed" toast shows (lib/shared/auth-block-messages.ts:74)',
      },
    },
    async ({ anon, visitor, customerEmail }) => {
      expect((await portalSignin(anon, customerEmail, '/roadmap')).status()).toBe(200)
      const { link } = await signInMail(customerEmail)

      // Use it once, in another browser.
      const first = await visitor()
      await first.goto(link)
      await first.waitForURL(`${baseUrl()}/roadmap`, { timeout: 15_000 })

      // The same link again, signed out.
      const page = await visitor()
      await page.goto(link)
      await page.waitForURL(/error=INVALID_TOKEN/, { timeout: 15_000 })
      await expect(page.getByRole('dialog').locator('#inline-email')).toBeVisible()
      expect(await getSession(page.request)).toBeNull()
      await expect(page.locator('[data-sonner-toast]').first()).toContainText(
        'Your login link has expired. Please request a new one.'
      )
    }
  )

  test(
    'PPL-AUTH-09 an expired sign-in link signs nobody in',
    { tag: '@core' },
    async ({ anon, visitor, customerEmail }) => {
      expect((await portalSignin(anon, customerEmail, '/roadmap')).status()).toBe(200)
      const { link } = await signInMail(customerEmail)
      await supportDb()`UPDATE verification SET expires_at = now() - interval '1 minute'
                        WHERE identifier = ${`magic-link:${tokenOf(link)}`}`

      const page = await visitor()
      await page.goto(link)
      await page.waitForURL(/[?&]auth=signin.*error=INVALID_TOKEN/, { timeout: 15_000 })
      await expect(page.getByRole('dialog').locator('#inline-email')).toBeVisible()
      expect(await getSession(page.request)).toBeNull()
      expect(await userRow(customerEmail)).toBeNull()
    }
  )

  test(
    'PPL-AUTH-12 portal-signin refuses a bad body before spending any budget',
    { tag: '@nightly' },
    async ({ anon, customerEmail }) => {
      const notJson = await anon.post('/api/auth/portal-signin', {
        headers: { 'content-type': 'application/json' },
        data: Buffer.from('not json{'),
      })
      expect(notJson.status()).toBe(400)
      expect(await notJson.json()).toEqual({ error: 'Invalid JSON body' })
      const noEmail = await portalSignin(anon, 'nobody')
      expect(noEmail.status()).toBe(400)
      expect(await noEmail.json()).toEqual({ error: 'Valid email required' })

      // Neither spent the address's budget: three real sends still go through.
      for (let i = 0; i < 3; i++)
        expect((await portalSignin(anon, customerEmail)).status()).toBe(200)
    }
  )

  test(
    'PPL-AUTH-14 portal-signin ignores an off-site callback',
    { tag: '@core' },
    async ({ newApi, visitor, marker }) => {
      for (const [i, evil] of ['https://evil.example/x', '//evil.example'].entries()) {
        const email = `${marker}-${i}@customers.example`
        const api = await newApi()
        expect((await portalSignin(api, email, evil)).status()).toBe(200)
        const link = new URL((await signInMail(email)).link)
        expect(link.searchParams.get('callbackURL'), evil).toBe(`${baseUrl()}/`)
        expect(link.searchParams.get('errorCallbackURL'), evil).toBe(`${baseUrl()}/auth/login`)
        if (i === 0) {
          const page = await visitor()
          await page.goto(link.toString())
          await page.waitForURL(`${baseUrl()}/`, { timeout: 15_000 })
          expect((await getSession(page.request))?.user.email).toBe(email)
        }
      }
    }
  )

  test(
    'PPL-AUTH-15 a team link fails back to the team sign-in',
    { tag: '@nightly' },
    async ({ anon, visitor, customerEmail }) => {
      expect((await portalSignin(anon, customerEmail, '/admin/feedback')).status()).toBe(200)
      const { link } = await signInMail(customerEmail)
      expect(new URL(link).searchParams.get('errorCallbackURL')).toBe(
        `${baseUrl()}/auth/login?callbackUrl=%2Fadmin%2Ffeedback`
      )
      // Spend it, then open it again signed out: the team dialog comes back.
      await supportDb()`DELETE FROM verification WHERE identifier = ${`magic-link:${tokenOf(link)}`}`
      const page = await visitor()
      await page.goto(link)
      await page.waitForURL(/callbackUrl=%2Fadmin%2Ffeedback/, { timeout: 15_000 })
      await expect(
        page.getByRole('dialog').getByText(`Sign in to ${WORKSPACE} admin`)
      ).toBeVisible()
    }
  )

  test(
    'PPL-AUTH-16 with the magic-link method off, portal-signin mails no working link',
    { tag: ['@core', '@isolated'] },
    async ({ anon, visitor, playwright, customerEmail }) => {
      test.skip(!ISOLATED, ISOLATED_SKIP)
      const existing = await portalUser(playwright, customerEmail)
      // A link mailed while the method was on.
      const before = await withAuthSettings(MAGIC_LINK_ON, async () => {
        expect((await portalSignin(anon, existing.email, '/roadmap')).status()).toBe(200)
        return signInMail(existing.email)
      })
      const code = await verificationRow(`sign-in-otp-${existing.email}`)
      expect(code).not.toBeNull()

      await withAuthSettings({ auth_config: { 'oauth.magicLink': false } }, async () => {
        // Refused before anything is minted: no new code, so nothing to mail.
        const res = await portalSignin(anon, existing.email, '/roadmap')
        expect(res.status()).toBe(403)
        expect(await res.json()).toEqual({
          error: "Magic-link sign-in isn't enabled for this workspace.",
          code: 'magic_link_method_not_allowed',
        })
        expect(await verificationRow(`sign-in-otp-${existing.email}`)).toEqual(code)

        // The link mailed earlier no longer signs anyone in, and is not spent.
        const page = await visitor()
        await page.goto(before.link)
        await page.waitForURL(/error=magic_link_method_not_allowed/, { timeout: 15_000 })
        expect(await getSession(page.request)).toBeNull()
        expect(await verificationRow(`magic-link:${tokenOf(before.link)}`)).not.toBeNull()
      })
      expect(
        (await subjectsTo(existing.email)).filter((s) => /is your code for/.test(s))
      ).toHaveLength(1)
    }
  )
})

test.describe('rate limits', () => {
  test(
    'PPL-AUTH-20 sign-in email limit per address and IP',
    { tag: '@core' },
    async ({ playwright, newApi, marker }) => {
      const known = await portalUser(playwright, `${marker}-known@customers.example`)
      const unknown = `${marker}-unknown@customers.example`
      const bodies: string[] = []
      for (const email of [known.email, unknown]) {
        const api = await newApi()
        for (let i = 0; i < 3; i++) expect((await portalSignin(api, email)).status()).toBe(200)
        const fourth = await portalSignin(api, email)
        expect(fourth.status(), email).toBe(429)
        const retryAfter = Number(fourth.headers()['retry-after'])
        expect(retryAfter).toBeGreaterThan(0)
        expect(retryAfter).toBeLessThanOrEqual(900)
        bodies.push(await fourth.text())
      }
      expect(JSON.parse(bodies[0])).toEqual({
        error: 'Too many sign-in attempts. Please wait a moment and try again.',
        code: 'rate_limited',
      })
      // The refusal says nothing about whether the address holds an account.
      expect(bodies[1]).toBe(bodies[0])

      // Only the three allowed sends reached the mailbox.
      await signInMails(known.email, 3)
      await new Promise((r) => setTimeout(r, 1_500))
      expect(
        (await subjectsTo(known.email)).filter((s) => /is your code for/.test(s))
      ).toHaveLength(3)
      const [bucket] = await supportDb()`
        SELECT key FROM rate_bucket WHERE key LIKE ${`signin:magiclink:%:${known.email}`}`
      expect(bucket).toBeTruthy()
    }
  )

  test(
    'PPL-AUTH-21 sign-in email limit per IP across addresses',
    { tag: '@nightly' },
    async ({ anon, marker }) => {
      test.setTimeout(120_000)
      const statuses: number[] = []
      for (let i = 0; i < 21; i++) {
        statuses.push((await portalSignin(anon, `${marker}-${i}@customers.example`)).status())
      }
      expect(statuses.slice(0, 20)).toEqual(Array(20).fill(200))
      expect(statuses[20]).toBe(429)
      await signInMail(`${marker}-19@customers.example`)
    }
  )

  test(
    'PPL-AUTH-22 password attempts limit per address and IP',
    { tag: '@core' },
    async ({ playwright, newApi, marker }) => {
      test.setTimeout(60_000)
      const person = await portalUser(playwright, `${marker}@customers.example`)
      const attacker = await newApi()
      const since = new Date()
      // The library allows 3 sign-in calls per 10 s per address, so space them.
      const started = Date.now()
      for (let i = 0; i < 3; i++) {
        expect((await signIn(attacker, person.email, 'wrong-password-x')).status()).toBe(401)
      }
      await new Promise((r) => setTimeout(r, Math.max(0, started + 10_500 - Date.now())))
      for (let i = 0; i < 2; i++) {
        expect((await signIn(attacker, person.email, 'wrong-password-x')).status()).toBe(401)
      }

      // Sixth attempt, right password: our limiter refuses it.
      const sixth = await signIn(attacker, person.email, person.password)
      expect(sixth.status()).toBe(429)
      expect(await sixth.json()).toMatchObject({
        code: 'rate_limited',
        message: 'Too many sign-in attempts. Please wait a moment and try again.',
      })
      expect(Number(sixth.headers()['retry-after'])).toBeGreaterThan(0)
      expect(await getSession(attacker)).toBeNull()
      const audit = await waitForAudit('auth.signin.rate_limited', { email: person.email, since })
      expect(audit.event_outcome).toBe('failure')
      expect(audit.metadata).toMatchObject({ provider: 'credential' })
      expect(Number(audit.metadata?.retryAfter)).toBeGreaterThan(0)

      // The owner, from another address, still gets in.
      const owner = await newApi()
      expect((await signIn(owner, person.email, person.password)).status()).toBe(200)
    }
  )

  test(
    'PPL-AUTH-25 the library limits sign-in calls per client address',
    { tag: '@nightly' },
    async ({ anon, newApi, marker }) => {
      const statuses: number[] = []
      const bodies: string[] = []
      for (let i = 0; i < 4; i++) {
        const res = await signIn(anon, `${marker}-${i}@customers.example`, 'whatever-123')
        statuses.push(res.status())
        bodies.push(await res.text())
      }
      expect(statuses).toEqual([401, 401, 401, 429])
      // The library's own answer, not our limiter's.
      expect(bodies[3]).not.toContain('rate_limited')
      // Another address is not affected.
      const other = await newApi()
      expect((await signIn(other, `${marker}-y@customers.example`, 'whatever-123')).status()).toBe(
        401
      )
    }
  )
})

test.describe('password', () => {
  test(
    'PPL-AUTH-27 password sign-up creates a portal account and signs in',
    { tag: '@core' },
    async ({ visitor, customerEmail }) => {
      const page = await visitor()
      await page.goto('/?auth=signup')
      const dialog = page.getByRole('dialog')
      await dialog.locator('#inline-email').fill(customerEmail)
      await dialog.getByRole('button', { name: /^Continue/ }).click()
      await dialog.locator('#inline-name').fill('Pat Newcomer')
      await dialog.locator('#inline-password').fill(PASSWORD)
      await dialog.getByRole('button', { name: 'Create account' }).click()
      await expect(dialog).toBeHidden()
      await expect(page.getByRole('button', { name: 'Open account menu' })).toBeVisible()

      const user = await userRow(customerEmail)
      expect(user).toMatchObject({ email_verified: false, name: 'Pat Newcomer' })
      const [account] =
        await supportDb()`SELECT provider_id FROM account WHERE user_id = ${user!.id}`
      expect(account.provider_id).toBe('credential')
      const [principal] = await supportDb()`
        SELECT role, type, display_name FROM principal WHERE user_id = ${user!.id}`
      expect(principal).toMatchObject({ role: 'user', type: 'user', display_name: 'Pat Newcomer' })
      const audit = await waitForAudit('auth.signin.success', { email: customerEmail })
      expect(audit.metadata).toMatchObject({ method: 'credential' })
      // First browser for this account: no new-device mail.
      await new Promise((r) => setTimeout(r, 2_000))
      expect(await subjectsTo(customerEmail)).not.toContain('New sign-in to your account')
    }
  )

  test(
    'PPL-AUTH-29 password length rules',
    { tag: '@nightly' },
    async ({ visitor, newApi, marker }) => {
      const page = await visitor()
      const signups: string[] = []
      page.on('request', (r) => {
        if (r.url().includes('/api/auth/sign-up')) signups.push(r.url())
      })
      await page.goto('/?auth=signup')
      const dialog = page.getByRole('dialog')
      await dialog.locator('#inline-email').fill(`${marker}-ui@customers.example`)
      await dialog.getByRole('button', { name: /^Continue/ }).click()
      await dialog.locator('#inline-password').fill('short77')
      await dialog.getByRole('button', { name: 'Create account' }).click()
      await expect(dialog.getByText('Password must be at least 8 characters')).toBeVisible()
      expect(signups).toEqual([])

      for (const [i, password] of ['short77', 'x'.repeat(129)].entries()) {
        const email = `${marker}-${i}@customers.example`
        const res = await signUp(await newApi(), email, password)
        expect(res.status(), `length ${password.length}`).toBe(400)
        expect(await res.text()).toMatch(i === 0 ? /too short/i : /too long/i)
        expect(await userRow(email)).toBeNull()
      }
    }
  )

  test(
    'PPL-AUTH-30 a wrong password reads the same for a known and an unknown address',
    { tag: '@core' },
    async ({ playwright, visitor, marker }) => {
      const person = await portalUser(playwright, `${marker}@customers.example`)
      const unknown = `${marker}-nobody@customers.example`
      for (const email of [person.email, unknown]) {
        const since = new Date()
        const page = await visitor()
        await dialogPasswordSignIn(page, email, 'not-the-password')
        await expect(page.getByRole('dialog').getByText('Invalid email or password')).toBeVisible()
        expect(await getSession(page.request)).toBeNull()
        const audit = await waitForAudit('auth.signin.failed', { email, since })
        expect(audit.auth_method).toBe('password')
        expect(audit.metadata).toEqual({ reason: 'INVALID_CREDENTIALS' })
        expect(JSON.stringify(audit)).not.toContain('not-the-password')
      }
    }
  )

  test(
    'PPL-AUTH-33 forgot password sends a reset link, and nothing to an unknown address',
    { tag: '@core' },
    async ({ playwright, visitor, marker }) => {
      const person = await portalUser(playwright, `${marker}@customers.example`)
      const unknown = `${marker}-nobody@customers.example`
      for (const email of [person.email, unknown]) {
        const page = await visitor()
        await page.goto('/?auth=signin')
        const dialog = page.getByRole('dialog')
        await dialog.locator('#inline-email').fill(email)
        await dialog.getByRole('button', { name: /^Continue/ }).click()
        await dialog.getByRole('button', { name: 'Forgot password?' }).click()
        await expect(dialog.locator('#inline-forgot-email')).toHaveValue(email)
        await dialog.getByRole('button', { name: 'Send reset link' }).click()
        await expect(
          dialog.getByText(
            `We sent a password reset link to ${email}. The link expires in 24 hours.`
          )
        ).toBeVisible()
      }
      const summary = await pollFor(
        'reset mail',
        async () =>
          (await mailTo(person.email)).find(
            (m) => m.Subject === `Reset your ${WORKSPACE} password`
          ) ?? null
      )
      const mail = await getMail(summary.ID)
      expect(mail.Text).toContain('This link expires in 24 hours.')
      const link = linksIn(mail).find((l) => l.includes('/api/auth/reset-password/'))
      expect(link).toBeTruthy()
      expect(new URL(link!).searchParams.get('callbackURL')).toBe('/auth/reset-password')
      const token = new URL(link!).pathname.split('/').pop()
      expect(await verificationRow(`reset-password:${token}`)).not.toBeNull()

      await new Promise((r) => setTimeout(r, 2_000))
      expect(await subjectsTo(unknown)).toEqual([])
    }
  )

  test(
    'PPL-AUTH-34 reset the password with the link',
    { tag: '@core' },
    async ({ playwright, newApi, visitor, marker }) => {
      const person = await portalUser(playwright, `${marker}@customers.example`)
      const link = await resetLink(await newApi(), person.email)
      const page = await visitor()
      await page.goto(link)
      await page.waitForURL(/\/auth\/reset-password\?token=/)
      // A server-rendered form: let it hydrate before typing.
      await page.waitForLoadState('networkidle')
      const newPassword = 'a-brand-new-password-2'
      await page.locator('#new-password').fill(newPassword)
      await page.locator('#confirm-password').fill(newPassword)
      await page.getByRole('button', { name: 'Reset password' }).click()
      await expect(page.getByText('Password reset', { exact: true })).toBeVisible()
      await expect(page.getByText('Your password has been updated successfully.')).toBeVisible()

      expect((await signIn(await newApi(), person.email, person.password)).status()).toBe(401)
      expect((await signIn(await newApi(), person.email, newPassword)).status()).toBe(200)
      expect((await userRow(person.email))?.email_verified).toBe(true)

      // The link is spent.
      const again = await visitor()
      await again.goto(link)
      await expect(again.getByText('This reset link is invalid or has expired.')).toBeVisible()
    }
  )

  test('PPL-AUTH-35 reset page refusals', { tag: '@nightly' }, async ({ visitor }) => {
    const page = await visitor()
    await page.goto('/auth/reset-password?error=INVALID_TOKEN')
    await expect(page.getByText('This reset link is invalid or has expired.')).toBeVisible()

    await page.goto('/auth/reset-password')
    // Without a token nothing can be typed or submitted.
    await expect(page.locator('#new-password')).toBeDisabled()
    await expect(page.locator('#confirm-password')).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Reset password' })).toBeDisabled()

    await page.goto('/auth/reset-password?token=not-a-real-token')
    await page.waitForLoadState('networkidle')
    await page.locator('#new-password').fill('first-password-1')
    await page.locator('#confirm-password').fill('second-password-1')
    await expect(page.getByRole('button', { name: 'Reset password' })).toBeDisabled()
  })

  test(
    'PPL-AUTH-41 the reserved anonymous domain cannot sign in or sign up',
    { tag: '@nightly' },
    async ({ anon, marker }) => {
      const email = `temp-${marker}@anon.quackback.io`
      for (const res of [await signUp(anon, email), await signIn(anon, email)]) {
        expect(res.status()).toBe(302)
        expect(res.headers().location).toBe('/?auth=signin&error=reserved_email_domain')
      }
      expect(await userRow(email)).toBeNull()
      const buckets = await supportDb()`SELECT key FROM rate_bucket WHERE key LIKE ${`%${email}%`}`
      expect(buckets).toEqual([])
    }
  )
})

test.describe('sessions', () => {
  /** A browser page signed up (and so signed in) as a new portal person. */
  async function signedUpPage(
    visitor: () => Promise<import('@playwright/test').Page>,
    email: string
  ) {
    const page = await visitor()
    await page.goto('/')
    const res = await page.request.post('/api/auth/sign-up/email', {
      data: { email, password: PASSWORD, name: 'Session Person' },
      headers: { origin: baseUrl() },
    })
    expect(res.status(), await res.text()).toBe(200)
    const user = await userRow(email)
    return { page, userId: user!.id }
  }

  test(
    'PPL-AUTH-51 signing out from the portal',
    { tag: '@core' },
    async ({ visitor, customerEmail }) => {
      const { page, userId } = await signedUpPage(visitor, customerEmail)
      await page.goto('/')
      await page.getByRole('button', { name: 'Open account menu' }).click()
      await page.getByRole('menuitem', { name: 'Sign out' }).click()
      await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible()
      await expect(page).toHaveURL(`${baseUrl()}/`)
      expect(await sessionsOf(userId)).toEqual([])
      expect(await getSession(page.request)).toBeNull()
    }
  )

  test(
    'PPL-AUTH-52 an expired session reads as signed out',
    { tag: '@nightly' },
    async ({ visitor, newTeammate, browser, customerEmail }) => {
      const { page, userId } = await signedUpPage(visitor, customerEmail)
      await supportDb()`UPDATE session SET expires_at = now() - interval '1 minute' WHERE user_id = ${userId}`
      expect(await getSession(page.request)).toBeNull()
      await page.goto('/')
      await expect(page.getByRole('button', { name: 'Log in' })).toBeVisible()

      const mate = await newTeammate({ roleKey: 'admin' })
      const matePage = await mate.newPage(browser)
      await supportDb()`UPDATE session SET expires_at = now() - interval '1 minute'
                        WHERE user_id = ${(await userRow(mate.email))!.id}`
      await matePage.goto('/admin/feedback')
      await expect(matePage).toHaveURL(/\?auth=signin&callbackUrl=%2Fadmin%2Ffeedback/)
    }
  )

  test(
    'PPL-AUTH-53 an active session slides forward',
    { tag: '@nightly' },
    async ({ visitor, customerEmail }) => {
      const { page, userId } = await signedUpPage(visitor, customerEmail)
      await supportDb()`UPDATE session SET expires_at = now() + interval '6 days' - interval '1 hour'
                        WHERE user_id = ${userId}`
      expect((await getSession(page.request))?.user.email).toBe(customerEmail)
      const [session] = await sessionsOf(userId)
      const days = (session.expires_at.getTime() - Date.now()) / 86_400_000
      expect(days).toBeGreaterThan(6.9)
      expect(days).toBeLessThanOrEqual(7.01)
    }
  )

  test(
    'PPL-AUTH-55 sign-in audit rows and country capture',
    { tag: '@nightly' },
    async ({ playwright, newApi, marker }) => {
      const person = await portalUser(playwright, `${marker}@customers.example`)
      const since = new Date()
      for (const [country, expected] of [
        ['DE', 'DE'],
        [null, 'DE'],
        ['XX', 'DE'],
      ] as const) {
        const api = await newApi()
        const res = await api.post('/api/auth/sign-in/email', {
          data: { email: person.email, password: person.password },
          headers: country ? { 'cf-ipcountry': country } : {},
        })
        expect(res.status()).toBe(200)
        await expect
          .poll(async () => (await userRow(person.email))?.country, { message: String(country) })
          .toBe(expected)
      }
      const rows = await audits('auth.signin.success', { email: person.email, since })
      expect(rows).toHaveLength(3)
      for (const row of rows) {
        expect(row.metadata).toEqual({ method: 'credential' })
        expect(row.actor_role).toBe('user')
      }
    }
  )

  test(
    'PPL-AUTH-56 a sign-in from a new browser mails the account once',
    { tag: '@core' },
    async ({ visitor, newApi, customerEmail }) => {
      // Browser A creates the account: the first device is recorded silently.
      const { page: a, userId } = await signedUpPage(visitor, customerEmail)
      const userTypeId = (await a.context().cookies()).find((c) =>
        c.name.startsWith('qb.device.')
      )?.name
      expect(userTypeId).toMatch(/^qb\.device\.user_/)

      // Browser B (a fresh cookie jar) signs in: one mail and an audit row.
      const since = new Date()
      const b = await newApi()
      expect((await signIn(b, customerEmail)).status()).toBe(200)
      const summary = await pollFor(
        'new-device mail',
        async () =>
          (await mailTo(customerEmail)).find((m) => m.Subject === 'New sign-in to your account') ??
          null
      )
      const mail = await getMail(summary.ID)
      expect(linksIn(mail)).toContain(`${baseUrl()}/settings/profile`)
      const audit = await waitForAudit('auth.signin.new_device', { email: customerEmail, since })
      expect(audit.metadata).toMatchObject({ ip: expect.any(String) })

      // Browser A again: a known device, no second mail.
      const again = await a.request.post('/api/auth/sign-in/email', {
        data: { email: customerEmail, password: PASSWORD },
        headers: { origin: baseUrl() },
      })
      expect(again.status()).toBe(200)
      await new Promise((r) => setTimeout(r, 2_500))
      expect(
        (await subjectsTo(customerEmail)).filter((s) => s === 'New sign-in to your account')
      ).toHaveLength(1)
      expect(await audits('auth.signin.new_device', { email: customerEmail, since })).toHaveLength(
        1
      )
      expect(userId).toBeTruthy()
    }
  )

  test(
    'PPL-AUTH-57 auth requests from another origin are refused',
    { tag: '@core' },
    async ({ playwright, anon, newApi, customerEmail, visitor }) => {
      const person = await portalUser(playwright, customerEmail)
      const evil = await anon.post('/api/auth/sign-in/email', {
        data: { email: person.email, password: person.password },
        headers: { origin: 'https://evil.example' },
      })
      expect(evil.status()).toBe(403)

      // A cookie-carrying POST with no Origin at all.
      const { page } = await signedUpPage(visitor, `b-${customerEmail}`)
      const noOrigin = await playwright.request.newContext({
        baseURL: baseUrl(),
        storageState: await page.context().storageState(),
      })
      const res = await noOrigin.post('/api/auth/update-user', { data: { name: 'Evil' } })
      expect(res.status()).toBe(403)
      await noOrigin.dispose()

      // A live link pointed off-site is refused and not spent.
      const sender = await newApi()
      expect((await portalSignin(sender, person.email)).status()).toBe(200)
      const token = tokenOf((await signInMail(person.email)).link)
      const verify = await anon.get(
        `/api/auth/magic-link/verify?token=${token}&callbackURL=${encodeURIComponent('https://evil.example/')}`,
        { maxRedirects: 0 }
      )
      expect(verify.status()).toBe(403)
      expect(await verificationRow(`magic-link:${token}`)).not.toBeNull()
    }
  )

  test(
    'PPL-AUTH-58 closed auth endpoints answer not found',
    { tag: '@nightly' },
    async ({ visitor, customerEmail }) => {
      const { page } = await signedUpPage(visitor, customerEmail)
      const headers = { origin: baseUrl() }
      for (const path of [
        '/api/auth/email-otp/change-email',
        '/api/auth/email-otp/request-email-change',
        '/api/auth/device/approve',
      ]) {
        const res = await page.request.post(path, {
          headers,
          data: { email: 'changed@customers.example', otp: '123456', userCode: 'X' },
        })
        expect(res.status(), path).toBe(404)
      }
      expect((await page.request.get('/api/auth/token', { headers })).status()).toBe(404)
      expect((await userRow(customerEmail))?.id).toBeTruthy()
      expect(await userRow('changed@customers.example')).toBeNull()
    }
  )
})
