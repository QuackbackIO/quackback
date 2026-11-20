/**
 * Team invitations and adding people to the team: invite by email, add a
 * portal user, the refusals that come back as values, the grant ceiling,
 * accepting an invitation, cancel and resend.
 *
 * Journeys: PPL-T-09, PPL-T-11, PPL-T-13, PPL-T-14, PPL-T-15, PPL-T-17 (smoke),
 * PPL-T-18, PPL-T-20, PPL-T-24, PPL-T-25
 */
import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { linksIn, waitForMail, mailTo } from '../../support/mailpit'
import {
  customRole,
  invitationFor,
  inviteByEmail,
  mustCall,
  personApi,
  portalUser,
  portalUserRow,
  principalByEmail,
  refusedCall,
  roleIdOf,
  roleOf,
  suffix,
} from '../../product/people-team'

function inviteeEmail(marker: string): string {
  return `${marker}-${suffix()}@invitees.example`
}

/** The "Accept invitation" link in the invitation email. */
async function acceptLink(email: string): Promise<string> {
  const mail = await waitForMail({ to: email, subject: 'invited you to', timeoutMs: 30_000 })
  const link = linksIn(mail).find((l) => /verify|magic|complete-signup|token/i.test(l))
  if (!link) throw new Error(`no accept link in ${linksIn(mail).join(' ')}`)
  return link
}

/**
 * Open an emailed invitation link and press the interstitial's "Accept
 * invitation" (the link itself never signs in, so mail scanners cannot spend it).
 */
async function followInviteLink(page: Page, link: string): Promise<void> {
  await page.goto(link)
  await page.getByRole('button', { name: 'Accept invitation' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/verify-magic-link'), {
    timeout: 15_000,
  })
}

test.describe('accepting an invitation', () => {
  test(
    'PPL-T-17 a new person accepts an emailed invitation and lands in the admin',
    { tag: '@smoke' },
    async ({ browser, playwright, marker }) => {
      const admin = await personApi(playwright, 'admin')
      const email = inviteeEmail(marker)
      const invite = await inviteByEmail(admin, email)
      await admin.dispose()
      expect(invite.status).toBe('pending')

      const page = await (await browser.newContext()).newPage()
      await followInviteLink(page, await acceptLink(email))
      await expect(page).toHaveURL(new RegExp(`/complete-signup/${invite.typeId}`), {
        timeout: 15_000,
      })
      await expect(page.getByRole('heading', { name: 'Welcome!' })).toBeVisible()
      const name = `Newcomer ${marker}`
      await page.getByLabel('Your name').fill(name)
      await page.getByLabel(/Set a password/).fill(`pw-${marker}`.slice(0, 30))
      await page.getByRole('button', { name: 'Get started' }).click()
      await expect(page).toHaveURL(/\/admin/, { timeout: 15_000 })

      const after = await invitationFor(email)
      expect(after?.status).toBe('accepted')
      const principal = await principalByEmail(email)
      expect(principal?.role).toBe('member')
      const [u] = await supportDb()`SELECT name FROM "user" WHERE lower(email) = ${email}`
      expect(u.name).toBe(name)
      const [account] =
        await supportDb()`SELECT password FROM account a JOIN "user" u ON u.id = a.user_id
        WHERE lower(u.email) = ${email} AND a.provider_id = 'credential'`
      expect(account?.password, 'the password was set').toBeTruthy()
      // Every link of the invitation is revoked.
      expect(after!.magic_link_tokens.length).toBeGreaterThan(0)
      const live = await supportDb()`SELECT v.identifier FROM verification v,
        unnest(${after!.magic_link_tokens}::text[]) t WHERE v.identifier LIKE '%' || t`
      expect(live).toHaveLength(0)
      await page.context().close()
    }
  )

  test(
    'PPL-T-18 an existing portal user accepts and keeps their principal',
    { tag: '@core' },
    async ({ browser, playwright, marker }) => {
      const person = await portalUser(browser, marker)
      const admin = await personApi(playwright, 'admin')
      const invite = await inviteByEmail(admin, person.email)
      await admin.dispose()

      const page = await person.context.newPage()
      await page.goto(`/complete-signup/${invite.typeId}`)
      await expect(page.getByRole('heading', { name: 'Welcome!' })).toBeVisible({
        timeout: 15_000,
      })
      await expect(page.getByLabel(/Set a password/)).toHaveCount(0)
      await page.getByLabel('Your name').fill(person.name)
      await page.getByRole('button', { name: 'Get started' }).click()
      await expect(page).toHaveURL(/\/admin/, { timeout: 15_000 })

      const principals =
        await supportDb()`SELECT id, role FROM principal WHERE user_id = ${person.userUuid}`
      expect(principals).toHaveLength(1)
      expect(principals[0].id).toBe(person.principalUuid)
      expect(principals[0].role).toBe('member')
      expect((await invitationFor(person.email))?.status).toBe('accepted')
    }
  )

  test(
    'PPL-T-20 the invitation page refuses a mismatch, a cancelled, an expired and an unknown invite',
    { tag: '@core' },
    async ({ browser, playwright, marker }) => {
      const admin = await personApi(playwright, 'admin')
      const stranger = await portalUser(browser, marker)
      const mismatch = await inviteByEmail(admin, inviteeEmail(marker))
      const page = await stranger.context.newPage()

      await page.goto(`/complete-signup/${mismatch.typeId}`)
      await expect(page.getByText('Unable to accept invitation')).toBeVisible({ timeout: 15_000 })
      await expect(page.getByText(/sent to a different email address/)).toBeVisible()

      const cancelled = await inviteByEmail(admin, stranger.email)
      await mustCall(admin, 'cancelInvitationFn', { invitationId: cancelled.typeId })
      await page.goto(`/complete-signup/${cancelled.typeId}`)
      await expect(page.getByText(/This invitation has been cancelled/)).toBeVisible({
        timeout: 15_000,
      })

      const expired = await inviteByEmail(admin, stranger.email)
      await supportDb()`UPDATE invitation SET expires_at = now() - interval '1 day' WHERE id = ${expired.id}`
      await page.goto(`/complete-signup/${expired.typeId}`)
      await expect(page.getByText(/This invitation has expired/)).toBeVisible({ timeout: 15_000 })

      await page.goto(`/complete-signup/invite_01kaaaaaaaaaaaaaaaaaaaaaaa`)
      await expect(page.getByText(/This invitation could not be found/)).toBeVisible({
        timeout: 15_000,
      })

      const [p] = await supportDb()`SELECT role FROM principal WHERE id = ${stranger.principalUuid}`
      expect(p.role).toBe('user')
      expect((await invitationFor(mismatch.email))?.status).toBe('pending')
      await admin.dispose()
    }
  )
})

test.describe('adding people', () => {
  test(
    'PPL-T-09 invite a new address from Members: email, invitation row and Invited row',
    { tag: '@core' },
    async ({ asPerson, marker }) => {
      const email = inviteeEmail(marker)
      const page = await asPerson('admin')
      await page.goto('/admin/settings/members')
      const dialog = page.getByRole('dialog')
      await expect(async () => {
        await page.getByRole('button', { name: 'Add people' }).click()
        await expect(dialog).toBeVisible({ timeout: 1_000 })
      }).toPass({ timeout: 15_000 })
      await dialog.getByRole('combobox').first().fill(email)
      await page.getByText(`Invite ${email}`).click()
      await dialog.getByRole('button', { name: 'Invite 1 person' }).click()
      await expect(page.getByText(`Invitation sent to ${email}.`)).toBeVisible()
      await expect(dialog).toHaveCount(0)

      const row = await invitationFor(email)
      expect(row).toMatchObject({ status: 'pending', role: 'member', role_id: null })
      expect(row!.magic_link_tokens).toHaveLength(1)
      const days = (row!.expires_at.getTime() - Date.now()) / 86_400_000
      expect(days).toBeGreaterThan(29)
      expect(days).toBeLessThan(31)

      const mail = await waitForMail({ to: email, subject: 'invited you to', timeoutMs: 30_000 })
      expect(mail.Subject).toContain('Ada Admin invited you to')
      expect(mail.Text).toContain('Not expecting this? You can ignore this email.')
      expect(mail.HTML).toContain('Accept invitation')

      await page
        .getByPlaceholder(/Search/)
        .first()
        .fill(email)
      await expect(page.getByRole('table').getByText(email)).toBeVisible()
      await expect(page.getByText('Invited', { exact: true }).first()).toBeVisible()
    }
  )

  test(
    'PPL-T-11 a signed-in portal user joins the team at once, keeps their content, and is audited',
    { tag: '@core' },
    async ({ browser, playwright, marker }) => {
      const person = await portalUser(browser, marker)
      const admin = await personApi(playwright, 'admin')
      const res = await mustCall<{ ok: boolean; added: unknown[]; invited: unknown[] }>(
        admin,
        'addTeamMembersFn',
        { principalIds: [person.principalId], emails: [], role: 'member' }
      )
      expect(res.ok).toBe(true)
      expect(res.added).toHaveLength(1)
      expect(res.invited).toHaveLength(0)
      expect(await roleOf(person.principalId)).toEqual({ role: 'member', assigned: 'manager' })
      expect(await invitationFor(person.email)).toBeNull()
      const audit = await supportDb()`SELECT before_value, after_value FROM audit_log
        WHERE event_type = 'user.role.changed' AND target_id = ${person.principalId}`
      expect(audit).toHaveLength(1)

      // Their next request opens the admin.
      const page = await person.context.newPage()
      await page.goto('/admin')
      await expect(page).toHaveURL(/\/admin/)
      await expect(page.getByRole('link', { name: 'Settings' }).first()).toBeVisible({
        timeout: 15_000,
      })
      await admin.dispose()
    }
  )

  test(
    'PPL-T-13 add refusals come back as values and write nothing',
    { tag: '@core' },
    async ({ playwright, people, marker, newTeammate }) => {
      const admin = await personApi(playwright, 'admin')
      const add = (data: Record<string, unknown>) =>
        mustCall<{ ok: boolean; code?: string; message?: string }>(admin, 'addTeamMembersFn', {
          principalIds: [],
          emails: [],
          role: 'member',
          ...data,
        })

      expect(await add({})).toMatchObject({
        ok: false,
        code: 'VALIDATION_ERROR',
        message: 'Choose at least one person to add',
      })
      const twice = inviteeEmail(marker)
      expect(await add({ emails: [twice, twice] })).toMatchObject({
        ok: false,
        message: `${twice} is listed more than once`,
      })
      const neverSignedIn = await portalUserRow(marker)
      expect(await add({ principalIds: [neverSignedIn.principalId] })).toMatchObject({
        ok: false,
        code: 'NOT_ELIGIBLE',
        message: `${neverSignedIn.name} hasn't signed in yet. Invite them by email instead.`,
      })
      const mate = await newTeammate({ roleKey: 'contributor' })
      expect(await add({ emails: [mate.email] })).toMatchObject({
        ok: false,
        code: 'ALREADY_MEMBER',
        message: `${mate.email} is already on the team`,
      })
      expect(await add({ principalIds: [people.people.admin.principalId] })).toMatchObject({
        ok: false,
        code: 'ALREADY_MEMBER',
        message: 'You are already on the team',
      })
      const pending = inviteeEmail(marker)
      await inviteByEmail(admin, pending)
      expect(await add({ emails: [pending] })).toMatchObject({
        ok: false,
        code: 'INVITE_PENDING',
        message: `${pending} already has a pending invitation`,
      })
      const anon = `temp-${suffix()}@anon.quackback.io`
      expect(await add({ emails: [anon] })).toMatchObject({
        ok: false,
        code: 'NOT_ELIGIBLE',
        message: `${anon} cannot receive an invitation`,
      })

      // Nothing was written for any refusal.
      for (const email of [twice, mate.email, anon]) {
        expect(await invitationFor(email), email).toBeNull()
      }
      expect((await roleOf(neverSignedIn.principalId)).role).toBe('user')
      expect(await mailTo(twice)).toHaveLength(0)
      await admin.dispose()
    }
  )

  test(
    'PPL-T-14 a member.manage holder cannot grant Admin or a role above their own',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      const managerRole = await customRole(marker, ['member.view', 'member.manage', 'people.view'])
      const caller = await newTeammate({ roleKey: managerRole.key })
      const api = await caller.api(playwright)
      const bigger = await customRole(`${marker}-big`, ['member.view', 'settings.manage'])
      const add = (data: Record<string, unknown>) =>
        mustCall<{ ok: boolean; code?: string; message?: string }>(api, 'addTeamMembersFn', {
          principalIds: [],
          emails: [inviteeEmail(marker)],
          role: 'member',
          ...data,
        })

      expect(await add({ role: 'admin' })).toMatchObject({
        ok: false,
        code: 'GRANT_CEILING',
        message: 'Only an admin can grant the Admin role',
      })
      expect(await add({ roleId: bigger.id })).toMatchObject({
        ok: false,
        code: 'GRANT_CEILING',
        message: "You can't grant a role with permissions you don't hold: settings.manage",
      })
      expect(await add({ role: 'admin', roleId: managerRole.id })).toMatchObject({
        ok: false,
        code: 'VALIDATION_ERROR',
        message: 'Custom role invites use the member role',
      })
      const [{ n }] = await supportDb()`SELECT count(*)::int AS n FROM invitation
        WHERE email LIKE ${`${marker}-%@invitees.example`}`
      expect(n).toBe(0)
      await api.dispose()
    }
  )

  test(
    'PPL-T-15 the Owner preset cannot be granted by role id',
    { tag: '@core' },
    async ({ browser, playwright, marker }) => {
      const admin = await personApi(playwright, 'admin')
      const owner = await roleIdOf('owner')
      const email = inviteeEmail(marker)
      const res = await refusedCall(admin, 'addTeamMembersFn', {
        principalIds: [],
        emails: [email],
        role: 'member',
        roleId: owner,
      })
      expect(res.error).toContain('Grant Owner by promoting to admin instead')
      expect(await invitationFor(email)).toBeNull()

      const person = await portalUser(browser, marker)
      await mustCall(admin, 'addTeamMembersFn', {
        principalIds: [person.principalId],
        emails: [],
        role: 'member',
      })
      const change = await refusedCall(admin, 'changeTeamRoleFn', {
        principalId: person.principalId,
        role: 'member',
        roleId: owner,
      })
      expect(change.error).toContain('Grant Owner by promoting to admin instead')
      expect(await roleOf(person.principalId)).toEqual({ role: 'member', assigned: 'manager' })
      await admin.dispose()
    }
  )
})

test.describe('managing invitations', () => {
  test(
    'PPL-T-24 cancelling an invitation revokes every link and a second cancel is not found',
    { tag: '@core' },
    async ({ browser, playwright, marker }) => {
      const admin = await personApi(playwright, 'admin')
      const email = inviteeEmail(marker)
      const invite = await inviteByEmail(admin, email)
      const firstLink = await acceptLink(email)
      await supportDb()`UPDATE invitation SET last_sent_at = now() - interval '10 minutes' WHERE id = ${invite.id}`
      await mustCall(admin, 'resendInvitationFn', { invitationId: invite.typeId })
      const tokens = (await invitationFor(email))!.magic_link_tokens
      expect(tokens).toHaveLength(2)

      await mustCall(admin, 'cancelInvitationFn', { invitationId: invite.typeId })
      expect((await invitationFor(email))?.status).toBe('canceled')

      // The emailed link no longer signs anyone in.
      const page = await (await browser.newContext()).newPage()
      await followInviteLink(page, firstLink)
      // The revoked link lands on the sign-in error, never the invitation page.
      await expect(page.getByRole('heading', { name: 'Welcome!' })).toHaveCount(0)
      await expect(page).not.toHaveURL(new RegExp(`/complete-signup/${invite.typeId}$`))
      expect(await principalByEmail(email)).toBeNull()
      await page.context().close()

      const again = await refusedCall(admin, 'cancelInvitationFn', { invitationId: invite.typeId })
      expect(again.code).toBe('INVITATION_NOT_FOUND')
      await admin.dispose()
    }
  )

  test(
    'PPL-T-25 resending sends a second email, renews the expiry and keeps the first link working',
    { tag: '@core' },
    async ({ browser, playwright, marker }) => {
      const admin = await personApi(playwright, 'admin')
      const email = inviteeEmail(marker)
      const invite = await inviteByEmail(admin, email)
      const firstLink = await acceptLink(email)
      await supportDb()`UPDATE invitation SET last_sent_at = now() - interval '10 minutes',
        expires_at = now() + interval '3 days' WHERE id = ${invite.id}`

      await mustCall(admin, 'resendInvitationFn', { invitationId: invite.typeId })
      await expect.poll(async () => (await mailTo(email)).length).toBe(2)
      const row = (await invitationFor(email))!
      expect(row.magic_link_tokens).toHaveLength(2)
      expect(Date.now() - row.last_sent_at!.getTime()).toBeLessThan(60_000)
      expect((row.expires_at.getTime() - Date.now()) / 86_400_000).toBeGreaterThan(29)

      const page = await (await browser.newContext()).newPage()
      await followInviteLink(page, firstLink)
      await expect(page.getByRole('heading', { name: 'Welcome!' })).toBeVisible({
        timeout: 15_000,
      })
      await page.context().close()
      await admin.dispose()
    }
  )
})
