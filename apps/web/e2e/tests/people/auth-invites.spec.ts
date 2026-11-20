/**
 * Portal invites: sending, resending, revoking, the invite page's states and
 * who may manage them. Every invite goes to an address only the test uses.
 *
 * Journeys: PPL-AUTH-67, 68, 69, 201, 202, 203, 205, 206, 208, 209.
 */
import type { APIRequestContext } from '@playwright/test'
import { fromUuid } from '@quackback/ids'
import { personApi, callServerFn } from '../../support/server-fns'
import { supportDb } from '../../support/db'
import { getMail, linksIn, mailTo } from '../../support/mailpit'
import { mintSession } from '../../support/teammates'
import { pollFor } from '../../support/db'
import {
  WORKSPACE,
  audits,
  baseUrl,
  expect,
  portalUser,
  test,
  visitorContext,
} from '../../product/auth'

interface InviteRow {
  id: string
  email: string
  status: string
  kind: string
  role: string | null
  expires_at: Date
  last_sent_at: Date | null
  magic_link_tokens: string[]
}

async function inviteRow(email: string): Promise<InviteRow> {
  const [row] = await supportDb()<InviteRow[]>`
    SELECT id, email, status, kind, role, expires_at, last_sent_at, magic_link_tokens
    FROM invitation WHERE email = ${email.toLowerCase()} AND kind = 'portal'
    ORDER BY created_at DESC LIMIT 1`
  return row
}

async function send(
  admin: APIRequestContext,
  emails: string[],
  message?: string
): Promise<{ email: string; ok: boolean; error?: string }[]> {
  const res = await callServerFn<{ results: { email: string; ok: boolean; error?: string }[] }>(
    admin,
    'sendPortalInviteFn',
    message ? { emails, message } : { emails }
  )
  expect(res.ok, res.error).toBe(true)
  return res.data.results
}

const inviteMails = async (email: string) =>
  (await mailTo(email)).filter((m) => m.Subject === `You've been invited to ${WORKSPACE}`)

test.describe('admin side', () => {
  test('PPL-AUTH-67 send one portal invite', { tag: '@core' }, async ({ playwright, marker }) => {
    const email = `${marker}@customers.example`
    const admin = await personApi(playwright, 'admin')
    const since = new Date()
    const [result] = await send(admin, [email.toUpperCase()], 'Come and vote on our roadmap')
    await admin.dispose()
    expect(result.ok).toBe(true)

    const row = await inviteRow(email)
    expect(row).toMatchObject({ email, status: 'pending', kind: 'portal', role: null })
    const days = (row.expires_at.getTime() - Date.now()) / 86_400_000
    expect(days).toBeGreaterThan(29.9)
    expect(days).toBeLessThanOrEqual(30)
    expect(row.magic_link_tokens).toHaveLength(1)
    const [verification] = await supportDb()`SELECT 1 FROM verification
      WHERE identifier = ${`magic-link:${row.magic_link_tokens[0]}`}`
    expect(verification).toBeTruthy()

    const summary = await pollFor('invite mail', async () => (await inviteMails(email))[0] ?? null)
    const mail = await getMail(summary.ID)
    expect(mail.Text).toContain(`You've been invited to access the ${WORKSPACE} portal.`)
    expect(mail.Text).toContain('Come and vote on our roadmap')
    const link = linksIn(mail).find((l) => l.includes('/verify-magic-link?token='))
    expect(new URL(link!).searchParams.get('callbackURL')).toBe(
      `${baseUrl()}/portal-invite/${fromUuid('invite', row.id)}`
    )

    const [audit] = await audits('portal.invite.sent', { since }).then((rows) =>
      rows.filter((r) => r.metadata?.email === email)
    )
    expect(audit.target_type).toBe('invitation')
    expect(audit.metadata).toMatchObject({ email, hasMessage: true })
  })

  test(
    'PPL-AUTH-68 a batch send reports each address that failed',
    { tag: '@core' },
    async ({ playwright, newTeammate, marker }) => {
      const fresh = `${marker}-new@customers.example`
      const pending = `${marker}-pending@customers.example`
      const mate = await newTeammate({ roleKey: 'support_lead' })
      const admin = await personApi(playwright, 'admin')
      await send(admin, [pending])
      const since = new Date()
      const results = await send(admin, [fresh, mate.email, pending])
      await admin.dispose()
      const by = Object.fromEntries(results.map((r) => [r.email, r]))
      expect(by[fresh].ok).toBe(true)
      expect(by[mate.email]).toMatchObject({
        ok: false,
        error: 'This person is already a team member and has access to the portal.',
      })
      expect(by[pending]).toMatchObject({
        ok: false,
        error: 'A pending portal invitation has already been sent to this email address.',
      })
      const sent = (await audits('portal.invite.sent', { since })).filter(
        (r) => r.metadata?.email === fresh
      )
      expect(sent).toHaveLength(1)
      expect(String(sent[0].metadata?.batchId)).toMatch(/^batch_/)
      expect(await inviteRow(mate.email)).toBeUndefined()
    }
  )

  test(
    'PPL-AUTH-69 the send validator caps the batch and the message',
    { tag: '@nightly' },
    async ({ playwright, marker }) => {
      const admin = await personApi(playwright, 'admin')
      const many = Array.from({ length: 51 }, (_, i) => `${marker}-${i}@customers.example`)
      const tooMany = await callServerFn(admin, 'sendPortalInviteFn', { emails: many })
      expect(tooMany.ok).toBe(false)
      const long = await callServerFn(admin, 'sendPortalInviteFn', {
        emails: [many[0]],
        message: 'x'.repeat(501),
      })
      expect(long.ok).toBe(false)
      await admin.dispose()
      const rows = await supportDb()`SELECT 1 FROM invitation WHERE email LIKE ${`${marker}-%`}`
      expect(rows).toHaveLength(0)
    }
  )

  test(
    'PPL-AUTH-202 revoke a pending invite; an accepted one cannot be revoked',
    { tag: '@core' },
    async ({ playwright, marker }) => {
      const email = `${marker}@customers.example`
      const admin = await personApi(playwright, 'admin')
      await send(admin, [email])
      const row = await inviteRow(email)
      const inviteId = fromUuid('invite', row.id)
      const since = new Date()
      const res = await callServerFn(admin, 'cancelPortalInviteFn', { inviteId })
      expect(res.ok, res.error).toBe(true)
      expect((await inviteRow(email)).status).toBe('canceled')
      const tokens = await supportDb()`SELECT 1 FROM verification
        WHERE identifier = ANY(${row.magic_link_tokens.map((t) => `magic-link:${t}`)})`
      expect(tokens).toHaveLength(0)
      const [audit] = await audits('portal.invite.revoked', { since, targetId: inviteId })
      expect(audit.after_value).toMatchObject({ status: 'canceled' })

      // An accepted invite stays accepted.
      const other = `${marker}-accepted@customers.example`
      await send(admin, [other])
      await supportDb()`UPDATE invitation SET status = 'accepted' WHERE email = ${other}`
      const refused = await callServerFn(admin, 'cancelPortalInviteFn', {
        inviteId: fromUuid('invite', (await inviteRow(other)).id),
      })
      await admin.dispose()
      expect(refused.ok).toBe(false)
      expect(refused.code).toBe('INVITE_NOT_PENDING')
      expect((await inviteRow(other)).status).toBe('accepted')
    }
  )

  test(
    'PPL-AUTH-203 resend a pending invite; an expired one is refused',
    { tag: '@core' },
    async ({ playwright, marker }) => {
      const email = `${marker}@customers.example`
      const admin = await personApi(playwright, 'admin')
      await send(admin, [email], 'First note')
      await pollFor('first invite mail', async () => (await inviteMails(email))[0] ?? null)
      await supportDb()`UPDATE invitation SET expires_at = now() + interval '2 days' WHERE email = ${email}`
      const before = await inviteRow(email)
      const inviteId = fromUuid('invite', before.id)
      const since = new Date()
      const res = await callServerFn(admin, 'resendPortalInviteFn', { inviteId })
      expect(res.ok, res.error).toBe(true)
      const after = await inviteRow(email)
      expect(after.magic_link_tokens).toHaveLength(2)
      expect(after.magic_link_tokens[0]).toBe(before.magic_link_tokens[0])
      expect((after.expires_at.getTime() - Date.now()) / 86_400_000).toBeGreaterThan(29.9)
      expect(after.last_sent_at!.getTime()).toBeGreaterThan(since.getTime() - 1_000)
      const mails = await pollFor('second invite mail', async () => {
        const found = await inviteMails(email)
        return found.length >= 2 ? found : null
      })
      expect((await getMail(mails[0].ID)).Text).not.toContain('First note')
      expect(await audits('portal.invite.resent', { since, targetId: inviteId })).toHaveLength(1)

      await supportDb()`UPDATE invitation SET expires_at = now() - interval '1 minute' WHERE email = ${email}`
      const expired = await callServerFn(admin, 'resendPortalInviteFn', { inviteId })
      await admin.dispose()
      expect(expired.ok).toBe(false)
      expect(expired.code).toBe('INVITE_EXPIRED')
    }
  )

  test(
    'PPL-AUTH-209 portal invite functions need settings.manage',
    { tag: '@core' },
    async ({ playwright, newTeammate, marker }) => {
      const email = `${marker}@customers.example`
      const admin = await personApi(playwright, 'admin')
      await send(admin, [email])
      await admin.dispose()
      const inviteId = fromUuid('invite', (await inviteRow(email)).id)
      for (const roleKey of ['support_lead', 'contributor']) {
        const mate = await newTeammate({ roleKey })
        const api = await mate.api(playwright)
        for (const [name, data, method] of [
          ['sendPortalInviteFn', { emails: [`${marker}-${roleKey}@customers.example`] }, 'POST'],
          ['cancelPortalInviteFn', { inviteId }, 'POST'],
          ['resendPortalInviteFn', { inviteId }, 'POST'],
          ['fetchPortalInvitesFn', undefined, 'GET'],
          ['getPortalInviteLinkFn', { inviteId }, 'POST'],
        ] as const) {
          const res = await callServerFn(api, name, data, { method })
          expect(res.ok, `${roleKey} ${name}`).toBe(false)
          expect(res.error, `${roleKey} ${name}`).toContain("Requires permission 'settings.manage'")
        }
        await api.dispose()
      }
      expect((await inviteRow(email)).status).toBe('pending')
      expect(await inviteRow(`${marker}-support_lead@customers.example`)).toBeUndefined()
    }
  )
})

test.describe('the invite page', () => {
  /** A browser signed in as a fresh portal person with a verified address. */
  async function signedInAs(
    browser: import('@playwright/test').Browser,
    playwright: import('@playwright/test').PlaywrightWorkerArgs['playwright'],
    email: string
  ) {
    const person = await portalUser(playwright, email)
    await supportDb()`UPDATE "user" SET email_verified = true WHERE id = ${person.userId}`
    const state = await mintSession(fromUuid('user', person.userId))
    const context = await visitorContext(browser, { storageState: state })
    return context.newPage()
  }

  test(
    'PPL-AUTH-201 accepting, then revisiting, an invite lands on the portal',
    {
      tag: ['@nightly', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          "The invite page's loader tests redirects with `'isRedirect' in err` (routes/portal-invite.$inviteId.tsx:53), but the router's redirect is a Response with `options` and no such property, so the redirect to / after a successful accept is swallowed and the page shows 'Something went wrong'",
      },
    },
    async ({ browser, playwright, marker }) => {
      const email = `${marker}@customers.example`
      const admin = await personApi(playwright, 'admin')
      await send(admin, [email])
      await admin.dispose()
      const inviteId = fromUuid('invite', (await inviteRow(email)).id)
      const page = await signedInAs(browser, playwright, email)
      const since = new Date()
      await page.goto(`/portal-invite/${inviteId}`)
      await page.waitForURL(`${baseUrl()}/`)
      expect((await inviteRow(email)).status).toBe('accepted')
      await page.goto(`/portal-invite/${inviteId}`)
      await page.waitForURL(`${baseUrl()}/`)
      expect(await audits('portal.invite.accepted', { since, targetId: inviteId })).toHaveLength(1)
      await page.context().close()
    }
  )

  test(
    'PPL-AUTH-205 an expired invite says so and changes nothing',
    { tag: '@nightly' },
    async ({ browser, playwright, marker }) => {
      const email = `${marker}@customers.example`
      const admin = await personApi(playwright, 'admin')
      await send(admin, [email])
      await admin.dispose()
      await supportDb()`UPDATE invitation SET expires_at = now() - interval '1 minute' WHERE email = ${email}`
      const page = await signedInAs(browser, playwright, email)
      await page.goto(`/portal-invite/${fromUuid('invite', (await inviteRow(email)).id)}`)
      await expect(page.getByText('Invite expired')).toBeVisible()
      await expect(
        page.getByText('This invitation has expired. Please ask the workspace admin to resend it.')
      ).toBeVisible()
      expect((await inviteRow(email)).status).toBe('pending')
      await page.context().close()
    }
  )

  test(
    'PPL-AUTH-206 opening an invite as the wrong account',
    { tag: '@core' },
    async ({ browser, playwright, marker }) => {
      const email = `${marker}@customers.example`
      const admin = await personApi(playwright, 'admin')
      await send(admin, [email])
      await admin.dispose()
      const inviteId = fromUuid('invite', (await inviteRow(email)).id)
      const since = new Date()
      const page = await signedInAs(browser, playwright, `${marker}-other@customers.example`)
      await page.goto(`/portal-invite/${inviteId}`)
      await expect(page.getByText('Wrong account')).toBeVisible()
      await expect(
        page.getByText('This invite was sent to a different email address.', { exact: false })
      ).toBeVisible()
      expect((await inviteRow(email)).status).toBe('pending')
      expect(await audits('portal.invite.accepted', { since, targetId: inviteId })).toHaveLength(0)
      await page.context().close()
    }
  )

  test(
    'PPL-AUTH-202 a revoked invite says so on its page',
    { tag: '@core' },
    async ({ browser, playwright, marker }) => {
      const email = `${marker}@customers.example`
      const admin = await personApi(playwright, 'admin')
      await send(admin, [email])
      const inviteId = fromUuid('invite', (await inviteRow(email)).id)
      expect((await callServerFn(admin, 'cancelPortalInviteFn', { inviteId })).ok).toBe(true)
      await admin.dispose()
      const page = await signedInAs(browser, playwright, email)
      await page.goto(`/portal-invite/${inviteId}`)
      await expect(page.getByText('Invite revoked')).toBeVisible()
      expect((await inviteRow(email)).status).toBe('canceled')
      await page.context().close()
    }
  )

  test(
    'PPL-AUTH-208 the invite page signed out, or for an unknown id',
    { tag: '@nightly' },
    async ({ browser, playwright, visitor, marker }) => {
      const email = `${marker}@customers.example`
      const admin = await personApi(playwright, 'admin')
      await send(admin, [email])
      await admin.dispose()
      const inviteId = fromUuid('invite', (await inviteRow(email)).id)

      const anon = await visitor()
      await anon.goto(`/portal-invite/${inviteId}`)
      await expect(anon).toHaveURL(
        `${baseUrl()}/?auth=signin&callbackUrl=${encodeURIComponent(`/portal-invite/${inviteId}`)}`
      )

      const page = await signedInAs(browser, playwright, `${marker}-x@customers.example`)
      await page.goto('/portal-invite/invite_01aaaaaaaaaaaaaaaaaaaaaaaa')
      await expect(page.getByText('Invite not found')).toBeVisible()
      await page.context().close()
    }
  )
})
