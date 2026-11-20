/**
 * The team roster (/admin/settings/members) and what changes a teammate's
 * role or membership: the members menu, the server functions behind it and
 * REST /api/v1/principals, with personal keys capped by their creator.
 *
 * Journeys: PPL-T-01, PPL-T-07, PPL-T-33, PPL-T-34, PPL-T-35, PPL-T-37,
 * PPL-T-39, PPL-T-41, PPL-T-42, PPL-T-44, PPL-T-46, PPL-T-47, PPL-T-48,
 * PPL-T-50
 */
import type { Page } from '@playwright/test'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { apiFor, expectJson } from '../../support/api-client'
import { supportEnv } from '../../support/env'
import { mintSession } from '../../support/teammates'
import {
  customRole,
  inviteByEmail,
  mustCall,
  personApi,
  portalUserRow,
  refusedCall,
  restPersonal,
  restWorkspace,
  roleOf,
  suffix,
  uuid,
} from '../../product/people-team'

/** audit_log rows of one event for one target. */
async function auditRows(eventType: string, targetId: string) {
  return supportDb()`SELECT actor_type, before_value, after_value, metadata FROM audit_log
    WHERE event_type = ${eventType} AND target_id = ${targetId} ORDER BY occurred_at`
}

/** Open a roster row's actions menu (retried until the page has hydrated). */
async function openMemberMenu(page: Page, name: string): Promise<void> {
  await expect(async () => {
    await page.getByRole('button', { name: `Actions for ${name}` }).click()
    await expect(page.getByRole('menuitem', { name: 'Remove from team' })).toBeVisible({
      timeout: 1_000,
    })
  }).toPass({ timeout: 15_000 })
}

test.describe('the roster', () => {
  test(
    'PPL-T-01 Members lists teammates with their role badge, pending invites, and no portal users',
    { tag: '@core' },
    async ({ asPerson, playwright, marker, newTeammate }) => {
      const contributor = await newTeammate({ roleKey: 'contributor', name: `Cora ${marker}` })
      const quiet = await newTeammate({ roleKey: 'manager', name: `Quiet ${marker}` })
      await supportDb()`DELETE FROM session WHERE user_id = ${uuid(quiet.userId)}`
      const portal = await portalUserRow(marker)
      const admin = await personApi(playwright, 'admin')
      const invitee = `${marker}-${suffix()}@invitees.example`
      await inviteByEmail(admin, invitee)
      await admin.dispose()

      const page = await asPerson('admin')
      await page.goto(`/admin/settings/members?q=${encodeURIComponent(marker)}`)
      await expect(page.getByRole('heading', { name: 'Members & Teams' })).toBeVisible({
        timeout: 15_000,
      })
      await expect(page.getByText('Who has access to your workspace.')).toBeVisible()
      const table = page.getByRole('table')
      const coraRow = table.getByRole('row').filter({ hasText: contributor.email })
      await expect(coraRow).toContainText('Contributor')
      const quietRow = table.getByRole('row').filter({ hasText: quiet.email })
      await expect(quietRow).toContainText('Never')
      const inviteRow = table.getByRole('row').filter({ hasText: invitee })
      await expect(inviteRow).toContainText('Invited')
      await expect(inviteRow).toContainText(/Expires in/)
      await expect(table.getByText(portal.email)).toHaveCount(0)
    }
  )

  test(
    'PPL-T-07 REST lists teammates at /principals and /members, and needs member.view',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      const mate = await newTeammate({ roleKey: 'contributor', name: `Mate ${marker}` })
      const portal = await portalUserRow(marker)
      const rest = await restWorkspace(playwright)
      const principals = await expectJson(await rest.get('/api/v1/principals'), 200)
      const members = await expectJson(await rest.get('/api/v1/members'), 200)
      const ids = (body: { data: Array<{ id: string }> }) => body.data.map((m) => m.id)
      expect(ids(principals)).toContain(mate.principalId)
      expect(ids(principals)).not.toContain(portal.principalId)
      expect(ids(members)).toContain(mate.principalId)
      expect(ids(members)).not.toContain(portal.principalId)
      const row = principals.data.find((m: { id: string }) => m.id === mate.principalId)
      expect(row).toMatchObject({ userId: mate.userId, email: mate.email, role: 'member' })
      expect(members.data.find((m: { id: string }) => m.id === mate.principalId)).toEqual(row)
      await rest.dispose()

      const anonymous = await apiFor(playwright, supportEnv().baseUrl, null)
      expect((await anonymous.get('/api/v1/principals')).status()).toBe(401)
      await anonymous.dispose()
      const noView = await customRole(marker, ['post.view_private'])
      const narrow = await restWorkspace(playwright, noView.key)
      const refused = await expectJson(await narrow.get('/api/v1/principals'), 403)
      expect(refused.error.code).toBe('FORBIDDEN')
      expect(refused.error.message).toBe("Requires the 'member.view' permission")
      await narrow.dispose()
    }
  )
})

test.describe('changing roles', () => {
  test(
    'PPL-T-33 the owner makes a teammate Admin from the members menu',
    { tag: '@core' },
    async ({ asPerson, marker, newTeammate }) => {
      const mate = await newTeammate({ roleKey: 'manager', name: `Promo ${marker}` })
      const page = await asPerson('admin')
      await page.goto(`/admin/settings/members?q=${encodeURIComponent(marker)}`)
      await openMemberMenu(page, mate.name)
      await page.getByRole('menuitem', { name: 'Admin', exact: true }).click()
      const dialog = page.getByRole('alertdialog')
      await expect(dialog).toContainText('Change role to Admin?')
      await expect(dialog).toContainText(
        `${mate.name} will be able to manage team settings, members, and all workspace configurations.`
      )
      await dialog.getByRole('button', { name: 'Change to Admin' }).click()
      await expect(dialog).toHaveCount(0)

      await expect.poll(async () => (await roleOf(mate.principalId)).role).toBe('admin')
      expect((await roleOf(mate.principalId)).assigned).toBe('owner')
      const audit = await auditRows('user.role.changed', mate.principalId)
      expect(audit).toHaveLength(1)
      await expect(
        page.getByRole('table').getByRole('row').filter({ hasText: mate.email })
      ).toContainText(/Owner|Admin/)
    }
  )

  test(
    'PPL-T-34 the owner gives a teammate a custom role; its permissions apply on the next request',
    { tag: '@core' },
    async ({ asPerson, browser, marker, newTeammate }) => {
      const role = await customRole(marker, ['member.view'])
      const mate = await newTeammate({ roleKey: 'manager', name: `Custom ${marker}` })
      const page = await asPerson('admin')
      await page.goto(`/admin/settings/members?q=${encodeURIComponent(marker)}`)
      await openMemberMenu(page, mate.name)
      await page.getByRole('menuitem', { name: role.name, exact: true }).click()
      const dialog = page.getByRole('alertdialog')
      await expect(dialog).toContainText(
        `${mate.name} will hold the "${role.name}" role and exactly the permissions it grants.`
      )
      await dialog.getByRole('button', { name: `Change to ${role.name}` }).click()
      await expect.poll(async () => (await roleOf(mate.principalId)).assigned).toBe(role.key)
      expect((await roleOf(mate.principalId)).role).toBe('member')
      const [grant] =
        await supportDb()`SELECT granted_by_principal_id FROM principal_role_assignments
        WHERE principal_id = ${uuid(mate.principalId)}`
      expect(grant.granted_by_principal_id).not.toBeNull()
      await expect(
        page.getByRole('table').getByRole('row').filter({ hasText: mate.email })
      ).toContainText(role.name)

      // Without post.view_private the feedback inbox is the no-access page.
      const theirs = await mate.newPage(browser)
      await theirs.goto('/admin/feedback')
      await expect(theirs.getByText(/You don.t have access/)).toBeVisible({ timeout: 15_000 })
    }
  )

  test(
    'PPL-T-35 choosing Member for a custom-role holder moves them to the Manager preset',
    {
      tag: ['@core', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'Member with no roleId keeps the custom assignment (principal.service.ts updateMemberRole, principal.factory.ts setMemberRole); see QUARANTINE.md',
      },
    },
    async ({ playwright, marker, newTeammate }) => {
      const role = await customRole(marker, ['member.view'])
      const mate = await newTeammate({ roleKey: role.key })
      const admin = await personApi(playwright, 'admin')
      const res = await mustCall<{ ok: boolean }>(admin, 'changeTeamRoleFn', {
        principalId: mate.principalId,
        role: 'member',
      })
      expect(res.ok).toBe(true)
      expect(await roleOf(mate.principalId)).toEqual({ role: 'member', assigned: 'manager' })
      await admin.dispose()
    }
  )

  test(
    'PPL-T-37 nobody can change or remove themselves',
    { tag: '@core' },
    async ({ playwright, newTeammate }) => {
      const me = await newTeammate({ roleKey: 'admin' })
      const api = await me.api(playwright)
      const change = await mustCall<{ ok: boolean; code?: string }>(api, 'changeTeamRoleFn', {
        principalId: me.principalId,
        role: 'member',
      })
      expect(change).toMatchObject({ ok: false, code: 'CANNOT_MODIFY_SELF' })
      const update = await refusedCall(api, 'updateMemberRoleFn', {
        principalId: me.principalId,
        role: 'member',
      })
      expect(update.code).toBe('CANNOT_MODIFY_SELF')
      const remove = await refusedCall(api, 'removeTeamMemberFn', { principalId: me.principalId })
      expect(remove.code).toBe('CANNOT_REMOVE_SELF')
      expect(await roleOf(me.principalId)).toEqual({ role: 'admin', assigned: 'admin' })
      expect(await auditRows('user.role.changed', me.principalId)).toHaveLength(0)
      await api.dispose()
    }
  )

  test(
    'PPL-T-39 a member.manage holder cannot grant Admin, touch an admin, or grant above themselves',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      const managerRole = await customRole(marker, ['member.view', 'member.manage'])
      const caller = await newTeammate({ roleKey: managerRole.key })
      const target = await newTeammate({ roleKey: 'contributor' })
      const anAdmin = await newTeammate({ roleKey: 'admin' })
      const bigger = await customRole(`${marker}-big`, ['member.view', 'settings.manage'])
      const api = await caller.api(playwright)

      const promote = await refusedCall(api, 'updateMemberRoleFn', {
        principalId: target.principalId,
        role: 'admin',
      })
      expect(promote.code).toBe('GRANT_CEILING')
      expect(promote.error).toContain('Only an admin can grant the Admin role')
      const demote = await refusedCall(api, 'updateMemberRoleFn', {
        principalId: anAdmin.principalId,
        role: 'member',
      })
      expect(demote.error).toContain('Only an admin can change or remove an admin')
      const remove = await refusedCall(api, 'removeTeamMemberFn', {
        principalId: anAdmin.principalId,
      })
      expect(remove.error).toContain('Only an admin can change or remove an admin')
      const richer = await refusedCall(api, 'updateMemberRoleFn', {
        principalId: target.principalId,
        role: 'member',
        roleId: bigger.id,
      })
      expect(richer.error).toContain(
        "You can't grant a role with permissions you don't hold: settings.manage"
      )
      expect(await roleOf(target.principalId)).toEqual({ role: 'member', assigned: 'contributor' })
      expect((await roleOf(anAdmin.principalId)).role).toBe('admin')
      await api.dispose()
    }
  )
})

test.describe('removing teammates and their sessions', () => {
  test(
    'PPL-T-41 removing a teammate makes them a portal user and revokes their personal keys',
    { tag: '@core' },
    async ({ asPerson, browser, playwright, marker, newTeammate }) => {
      const mate = await newTeammate({ roleKey: 'manager', name: `Leaver ${marker}` })
      const personal = await restPersonal(playwright, mate.email)
      const page = await asPerson('admin')
      await page.goto(`/admin/settings/members?q=${encodeURIComponent(marker)}`)
      await openMemberMenu(page, mate.name)
      await page.getByRole('menuitem', { name: 'Remove from team' }).click()
      const dialog = page.getByRole('alertdialog')
      await expect(dialog).toContainText('Remove team member?')
      await expect(dialog).toContainText(
        `${mate.name} will be removed from the team and converted to a portal user.`
      )
      await dialog.getByRole('button', { name: 'Remove from team' }).click()
      await expect(dialog).toHaveCount(0)
      await expect(page.getByRole('table').getByText(mate.email)).toHaveCount(0)

      await expect.poll(() => roleOf(mate.principalId)).toEqual({ role: 'user', assigned: null })
      const [key] =
        await supportDb()`SELECT revoked_at FROM api_keys WHERE id = ${uuid(personal.keyId)}`
      expect(key.revoked_at).not.toBeNull()
      expect(await auditRows('user.removed', mate.principalId)).toHaveLength(1)
      // The session survives; the admin turns them away.
      const theirs = await mate.newPage(browser)
      await theirs.goto('/admin')
      await expect(theirs).toHaveURL(/error=not_team_member/, { timeout: 15_000 })
      await personal.api.dispose()
    }
  )

  test(
    'PPL-T-42 a removed teammate personal key stops working at once and stays revoked',
    { tag: '@core' },
    async ({ playwright, newTeammate }) => {
      const mate = await newTeammate({ roleKey: 'manager' })
      const personal = await restPersonal(playwright, mate.email)
      await expectJson(await personal.api.get('/api/v1/principals'), 200)
      const admin = await personApi(playwright, 'admin')
      await mustCall(admin, 'removeTeamMemberFn', { principalId: mate.principalId })
      expect((await personal.api.get('/api/v1/principals')).status()).toBe(401)

      await mustCall(admin, 'updateMemberRoleFn', { principalId: mate.principalId, role: 'member' })
      expect((await roleOf(mate.principalId)).role).toBe('member')
      expect((await personal.api.get('/api/v1/principals')).status()).toBe(401)
      await personal.api.dispose()
      await admin.dispose()
    }
  )

  test(
    'PPL-T-44 sign out everywhere ends every session of the teammate and is audited',
    { tag: '@core' },
    async ({ asPerson, marker, newTeammate }) => {
      const mate = await newTeammate({ roleKey: 'manager', name: `Signout ${marker}` })
      await mintSession(mate.userId)
      const page = await asPerson('admin')
      await page.goto(`/admin/settings/members?q=${encodeURIComponent(marker)}`)
      await openMemberMenu(page, mate.name)
      await page.getByRole('menuitem', { name: 'Sign out everywhere' }).click()
      const dialog = page.getByRole('alertdialog')
      await expect(dialog).toContainText('Sign out everywhere?')
      await dialog.getByRole('button', { name: 'Sign out everywhere' }).click()
      await expect(page.getByText(`Signed ${mate.name} out of 2 sessions.`)).toBeVisible()

      const sessions =
        await supportDb()`SELECT id FROM session WHERE user_id = ${uuid(mate.userId)}`
      expect(sessions).toHaveLength(0)
      const audit = await auditRows('session.revoked.individual', mate.userId)
      expect(audit).toHaveLength(1)
      expect(audit[0].metadata).toMatchObject({ count: 2, reason: 'admin_forced' })
      expect((await roleOf(mate.principalId)).role).toBe('member')
    }
  )
})

test.describe('REST role changes and removal', () => {
  test(
    'PPL-T-46 REST changes a teammate role, validates the body, and needs member.manage',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      const mate = await newTeammate({ roleKey: 'manager' })
      const role = await customRole(marker, ['member.view'])
      const rest = await restWorkspace(playwright, 'owner')

      const toAdmin = await expectJson(
        await rest.patch(`/api/v1/principals/${mate.principalId}`, { data: { role: 'admin' } }),
        200
      )
      expect(toAdmin.data.role).toBe('admin')
      expect(await roleOf(mate.principalId)).toEqual({ role: 'admin', assigned: 'owner' })
      const audit = await auditRows('user.role.changed', mate.principalId)
      expect(audit.at(-1)?.actor_type).toBe('api_key')

      await expectJson(
        await rest.patch(`/api/v1/principals/${mate.principalId}`, {
          data: { role: 'member', roleId: role.id },
        }),
        200
      )
      expect(await roleOf(mate.principalId)).toEqual({ role: 'member', assigned: role.key })

      const bad = await expectJson(
        await rest.patch(`/api/v1/principals/${mate.principalId}`, { data: { role: 'boss' } }),
        400
      )
      expect(bad.error.code).toBe('BAD_REQUEST')
      await rest.dispose()

      const viewOnly = await customRole(`${marker}-v`, ['member.view'])
      const narrow = await restWorkspace(playwright, viewOnly.key)
      const refused = await expectJson(
        await narrow.patch(`/api/v1/principals/${mate.principalId}`, { data: { role: 'admin' } }),
        403
      )
      expect(refused.error.message).toBe("Requires the 'member.manage' permission")
      expect((await roleOf(mate.principalId)).role).toBe('member')
      await narrow.dispose()
    }
  )

  test(
    'PPL-T-46 a body that is not JSON is refused as a bad request',
    { tag: '@core' },
    async ({ playwright, newTeammate }) => {
      const mate = await newTeammate({ roleKey: 'manager' })
      const rest = await restWorkspace(playwright, 'owner')
      const res = await rest.patch(`/api/v1/principals/${mate.principalId}`, {
        headers: { 'content-type': 'application/json' },
        data: '{not json',
      })
      expect(res.status(), await res.text()).toBe(400)
      expect((await roleOf(mate.principalId)).role).toBe('member')
      await rest.dispose()
    }
  )

  test(
    'PPL-T-47 REST removes a teammate, then the repeat is not found',
    { tag: '@core' },
    async ({ playwright, newTeammate }) => {
      const mate = await newTeammate({ roleKey: 'manager' })
      const rest = await restWorkspace(playwright)
      const res = await rest.delete(`/api/v1/principals/${mate.principalId}`)
      expect(res.status(), await res.text()).toBe(204)
      expect((await roleOf(mate.principalId)).role).toBe('user')
      const again = await expectJson(await rest.delete(`/api/v1/members/${mate.principalId}`), 404)
      expect(again.error).toMatchObject({ code: 'NOT_FOUND', message: 'Member not found' })
      await rest.dispose()
    }
  )

  test(
    'PPL-T-48 a personal key cannot change or remove its own creator',
    {
      tag: ['@core', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'REST self guards compare the target with the key service principal, not its creator (api/v1/principals/$principalId.ts); see QUARANTINE.md',
      },
    },
    async ({ playwright, newTeammate }) => {
      const owner = await newTeammate({ roleKey: 'admin' })
      const personal = await restPersonal(playwright, owner.email)
      const change = await personal.api.patch(`/api/v1/principals/${owner.principalId}`, {
        data: { role: 'member' },
      })
      expect(change.status(), await change.text()).toBe(403)
      const remove = await personal.api.delete(`/api/v1/principals/${owner.principalId}`)
      expect(remove.status(), await remove.text()).toBe(403)
      expect((await roleOf(owner.principalId)).role).toBe('admin')
      await personal.api.dispose()
    }
  )

  test(
    'PPL-T-50 a personal key loses what its creator loses',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      const owner = await newTeammate({ roleKey: 'admin' })
      const personal = await restPersonal(playwright, owner.email)
      await expectJson(await personal.api.get('/api/v1/users?limit=1'), 200)

      const narrow = await customRole(marker, ['member.view'])
      const admin = await personApi(playwright, 'admin')
      await mustCall(admin, 'updateMemberRoleFn', {
        principalId: owner.principalId,
        role: 'member',
        roleId: narrow.id,
      })
      await admin.dispose()

      const refused = await expectJson(await personal.api.get('/api/v1/users?limit=1'), 403)
      expect(refused.error).toMatchObject({
        code: 'FORBIDDEN',
        message: "Requires the 'people.view' permission",
      })
      await expectJson(await personal.api.get('/api/v1/principals'), 200)
      await personal.api.dispose()
    }
  )
})
