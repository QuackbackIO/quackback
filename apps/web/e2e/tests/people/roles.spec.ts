/**
 * Roles: read-only presets, authoring a custom role, the grant ceiling,
 * roles you hold, editing a role's holders' access, deleting with a move.
 *
 * Journeys: PPL-T-53, PPL-T-54, PPL-T-56, PPL-T-58, PPL-T-59, PPL-T-60,
 * PPL-T-61
 */
import { fromUuid, generateId } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import {
  callServerFn,
  customRole,
  mustCall,
  personApi,
  refusedCall,
  roleIdOf,
  roleOf,
  uuid,
} from '../../product/people-team'

/** Permission keys a role holds, sorted. */
async function keysOf(roleId: string): Promise<string[]> {
  const rows = await supportDb()`SELECT p.key FROM role_permissions rp
    JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = ${uuid(roleId)}`
  return rows.map((r) => r.key as string).sort()
}

async function roleRow(roleId: string) {
  const [row] = await supportDb()`SELECT name, is_system FROM roles WHERE id = ${uuid(roleId)}`
  return row ?? null
}

test.describe('presets and authoring', () => {
  test(
    'PPL-T-53 presets are read-only on the page and on the server',
    { tag: '@core' },
    async ({ asPerson, playwright }) => {
      const contributor = await roleIdOf('contributor')
      const page = await asPerson('admin')
      await page.goto(`/admin/settings/members/roles/${contributor}`)
      await expect(page.getByRole('button', { name: /Duplicate/ })).toBeVisible({
        timeout: 15_000,
      })
      await expect(page.getByLabel('Name')).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Save role' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Delete role' })).toHaveCount(0)

      const before = await keysOf(contributor)
      const admin = await personApi(playwright, 'admin')
      const update = await refusedCall(admin, 'updateRoleFn', {
        roleId: contributor,
        permissionKeys: ['member.view'],
      })
      expect(update.code).toBe('SYSTEM_ROLE')
      const remove = await refusedCall(admin, 'deleteRoleFn', { roleId: contributor })
      expect(remove.code).toBe('SYSTEM_ROLE')
      expect(await keysOf(contributor)).toEqual(before)
      await admin.dispose()
    }
  )

  test(
    'PPL-T-54 the owner creates a custom role with chosen permissions',
    { tag: '@core' },
    async ({ asPerson, marker }) => {
      const name = `Role ${marker}`.slice(0, 60)
      const page = await asPerson('admin')
      await page.goto('/admin/settings/members/roles/new')
      // Retried until the editor has hydrated (an early fill is reset by it).
      await expect(async () => {
        const box = page.getByRole('checkbox', { name: 'member.view', exact: true })
        if (!(await box.isVisible()))
          await page.getByRole('button', { name: /^Members \d+ of/ }).click()
        await box.check({ timeout: 2_000 })
        await expect(box).toBeChecked()
      }).toPass({ timeout: 20_000 })
      await page.getByLabel('Name').fill(name)
      await page.getByLabel('Description').fill('people e2e')
      await expect(page.getByLabel('Name')).toHaveValue(name)
      await page.getByRole('button', { name: 'Create role' }).click()
      await expect(page.getByText('Role created')).toBeVisible({ timeout: 15_000 })

      const [row] = await supportDb()`SELECT is_system FROM roles WHERE name = ${name}`
      expect(row.is_system).toBe(false)
      const roleId = (await roleIdByName(name))!
      expect(await keysOf(roleId)).toEqual(['member.view'])
      const audit = await supportDb()`SELECT after_value FROM audit_log
        WHERE event_type = 'role.created' AND target_id = ${roleId}`
      expect(audit).toHaveLength(1)
      expect(audit[0].after_value).toMatchObject({ name, permissionCount: 1 })
    }
  )

  test(
    'PPL-T-56 a limited editor cannot grant permissions they do not hold',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      const editorRole = await customRole(marker, ['role.manage', 'member.view'])
      const editor = await newTeammate({ roleKey: editorRole.key })
      const api = await editor.api(playwright)
      const name = `Too big ${marker}`.slice(0, 60)
      const create = await refusedCall(api, 'createRoleFn', {
        name,
        permissionKeys: ['member.view', 'settings.manage'],
      })
      expect(create.code).toBe('GRANT_CEILING')
      expect(create.error).toContain("You can't grant permissions you don't hold: settings.manage")
      expect(await roleIdByName(name)).toBeNull()

      const other = await customRole(`${marker}-o`, ['member.view'])
      const update = await refusedCall(api, 'updateRoleFn', {
        roleId: other.id,
        permissionKeys: ['member.view', 'billing.manage'],
      })
      expect(update.code).toBe('GRANT_CEILING')
      expect(await keysOf(other.id)).toEqual(['member.view'])
      await api.dispose()
    }
  )

  test(
    'PPL-T-58 nobody edits or deletes a role they hold',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      const role = await customRole(marker, ['role.manage', 'member.view'])
      const holder = await newTeammate({ roleKey: role.key })
      const api = await holder.api(playwright)
      const edit = await refusedCall(api, 'updateRoleFn', { roleId: role.id, name: 'Renamed' })
      expect(edit.code).toBe('ROLE_HELD')
      expect(edit.error).toContain("You can't edit a role you currently hold")
      const remove = await refusedCall(api, 'deleteRoleFn', { roleId: role.id })
      expect(remove.code).toBe('ROLE_HELD')
      expect((await roleRow(role.id))?.name).toBe(role.name)
      await api.dispose()
    }
  )
})

test.describe("changing a role's holders", () => {
  test(
    'PPL-T-59 removing a key from a role takes it from every holder on the next request',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      const role = await customRole(marker, ['changelog.view_draft', 'member.view'])
      const holder = await newTeammate({ roleKey: role.key })
      const theirs = await holder.api(playwright)
      await mustCall(theirs, 'listChangelogsFn', { status: 'all' }, { method: 'GET' })

      const admin = await personApi(playwright, 'admin')
      await mustCall(admin, 'updateRoleFn', { roleId: role.id, permissionKeys: ['member.view'] })
      const audit = await supportDb()`SELECT before_value, after_value FROM audit_log
        WHERE event_type = 'role.updated' AND target_id = ${role.id}`
      expect(audit).toHaveLength(1)

      const refused = await callServerFn(
        theirs,
        'listChangelogsFn',
        { status: 'all' },
        {
          method: 'GET',
        }
      )
      expect(refused.ok).toBe(false)
      expect(refused.error).toContain("Requires permission 'changelog.view_draft'")

      await mustCall(admin, 'updateRoleFn', {
        roleId: role.id,
        permissionKeys: ['member.view', 'changelog.view_draft'],
      })
      await mustCall(theirs, 'listChangelogsFn', { status: 'all' }, { method: 'GET' })
      await theirs.dispose()
      await admin.dispose()
    }
  )

  test(
    'PPL-T-60 deleting a role with holders moves them to the chosen role',
    { tag: '@core' },
    async ({ asPerson, marker, newTeammate }) => {
      const role = await customRole(marker, ['member.view'])
      const a = await newTeammate({ roleKey: role.key })
      const b = await newTeammate({ roleKey: role.key })
      const page = await asPerson('admin')
      await page.goto(`/admin/settings/members/roles/${role.id}`)
      await expect(async () => {
        await page.getByRole('button', { name: 'Delete role' }).click()
        await expect(page.getByRole('dialog')).toBeVisible({ timeout: 1_000 })
      }).toPass({ timeout: 15_000 })
      const dialog = page.getByRole('dialog')
      await expect(dialog).toContainText(
        '2 members hold this role. Choose the role they should move to. They keep workspace access either way.'
      )
      await dialog.getByRole('combobox').click()
      await expect(page.getByRole('option', { name: 'Owner', exact: true })).toHaveCount(0)
      await expect(page.getByRole('option', { name: role.name, exact: true })).toHaveCount(0)
      await page.getByRole('option', { name: 'Manager', exact: true }).click()
      await dialog.getByRole('button', { name: 'Delete role' }).click()
      await expect(page.getByText('Role deleted')).toBeVisible({ timeout: 15_000 })

      expect(await roleRow(role.id)).toBeNull()
      expect((await roleOf(a.principalId)).assigned).toBe('manager')
      expect((await roleOf(b.principalId)).assigned).toBe('manager')
      const audit = await supportDb()`SELECT before_value FROM audit_log
        WHERE event_type = 'role.deleted' AND target_id = ${role.id}`
      expect(audit).toHaveLength(1)
      expect(audit[0].before_value).toMatchObject({ holders: 2 })
    }
  )

  test(
    'PPL-T-61 delete refuses a move to itself, to Owner, above the editor, or to an unknown role',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      const role = await customRole(marker, ['member.view'])
      const holder = await newTeammate({ roleKey: role.key })
      const admin = await personApi(playwright, 'admin')

      const self = await refusedCall(admin, 'deleteRoleFn', {
        roleId: role.id,
        reassignToRoleId: role.id,
      })
      expect(self.error).toContain('Cannot reassign a role to itself')
      const owner = await refusedCall(admin, 'deleteRoleFn', {
        roleId: role.id,
        reassignToRoleId: await roleIdOf('owner'),
      })
      expect(owner.error).toContain('Reassigning to Owner is not allowed')
      const unknown = await refusedCall(admin, 'deleteRoleFn', {
        roleId: role.id,
        reassignToRoleId: generateId('role'),
      })
      expect(unknown.code).toBe('ROLE_NOT_FOUND')
      const missing = await refusedCall(admin, 'deleteRoleFn', { roleId: role.id })
      expect(missing.code).toBe('ROLE_IN_USE')

      const editorRole = await customRole(`${marker}-e`, ['role.manage', 'member.view'])
      const editor = await newTeammate({ roleKey: editorRole.key })
      const limited = await editor.api(playwright)
      const above = await refusedCall(limited, 'deleteRoleFn', {
        roleId: role.id,
        reassignToRoleId: await roleIdOf('admin'),
      })
      expect(above.code).toBe('GRANT_CEILING')

      expect((await roleRow(role.id))?.name).toBe(role.name)
      expect((await roleOf(holder.principalId)).assigned).toBe(role.key)
      await limited.dispose()
      await admin.dispose()
    }
  )
})

async function roleIdByName(name: string): Promise<string | null> {
  const [row] = await supportDb()`SELECT id FROM roles WHERE name = ${name}`
  return row ? fromUuid('role', row.id as string) : null
}
