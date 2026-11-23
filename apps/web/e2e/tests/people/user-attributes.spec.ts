/**
 * User attribute definitions (/admin/settings/people) and how they gate
 * attribute writes.
 *
 * Journeys: PPL-U-50, PPL-U-55, PPL-U-56
 */
import { randomBytes } from 'node:crypto'
import { fromUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { createRole } from '../../support/access'
import { expectJson } from '../../support/api-client'
import {
  call,
  metadataOf,
  mustCall,
  personApi,
  portalUserRow,
  restAdmin,
  seedUserAttribute,
} from '../../product/people'

const fromDefinition = (id: string) => fromUuid('user_attr', id)

async function definitionByKey(key: string) {
  const [row] = await supportDb()`SELECT id, key, label, type, description, external_key
    FROM user_attribute_definitions WHERE key = ${key}`
  return row
}

test(
  'PPL-U-50 creating an attribute normalises its key and lists it after a reload',
  { tag: '@core' },
  async ({ asPerson, playwright, marker }) => {
    const hex = randomBytes(4).toString('hex')
    const admin = await asPerson('admin')
    await admin.goto('/admin/settings/people')
    await admin.getByRole('button', { name: 'New attribute' }).click()
    const dialog = admin.getByRole('dialog')
    const create = dialog.getByRole('button', { name: 'Create attribute' })
    await expect(create).toBeDisabled()
    // The field rewrites what is typed as it goes: lowercase, anything but
    // letters, digits and underscores becomes an underscore.
    const keyBox = dialog.getByLabel(/^Key/)
    await keyBox.fill(`Plan Tier ${hex}`)
    await expect(keyBox).toHaveValue(`plan_tier_${hex}`)
    await expect(create).toBeDisabled()
    await dialog.getByLabel('Display label').fill(`  Plan ${marker} `)
    await expect(create).toBeEnabled()
    await create.click()
    await expect(dialog).toHaveCount(0)

    const key = `plan_tier_${hex}`
    const row = await definitionByKey(key)
    expect(row).toMatchObject({
      key,
      label: `Plan ${marker}`,
      type: 'string',
      description: null,
      external_key: null,
    })
    await admin.reload()
    await expect(admin.getByText(`Plan ${marker}`, { exact: true })).toBeVisible({
      timeout: 15_000,
    })
    await expect(admin.getByText(key, { exact: true })).toBeVisible()

    // The server normalises a key that reaches it untrimmed.
    const api = await personApi(playwright, 'admin')
    await mustCall(api, 'createUserAttributeFn', {
      key: `  Plan Tier ${hex}b `,
      label: ` Plan ${marker} b `,
      type: 'string',
    })
    await api.dispose()
    expect(await definitionByKey(`plan_tier_${hex}b`)).toMatchObject({ label: `Plan ${marker} b` })
  }
)

test(
  'PPL-U-55 deleting an attribute keeps stored values but refuses new writes',
  { tag: '@core' },
  async ({ playwright, marker }) => {
    const key = await seedUserAttribute('string')
    const person = await portalUserRow(marker)
    // The value as an earlier write stored it.
    await supportDb()`UPDATE "user" SET metadata = ${JSON.stringify({ [key]: 'pro' })}
                      WHERE id = ${person.userUuid}`
    const def = await definitionByKey(key)

    const admin = await personApi(playwright, 'admin')
    await mustCall(admin, 'deleteUserAttributeFn', { id: fromDefinition(def.id as string) })
    await admin.dispose()
    expect(await definitionByKey(key)).toBeUndefined()
    expect(await metadataOf(person.userUuid)).toMatchObject({ [key]: 'pro' })

    const rest = await restAdmin(playwright)
    const shown = await expectJson(await rest.get(`/api/v1/users/${person.principalId}`), 200)
    expect(shown.data.attributes).toMatchObject({ [key]: 'pro' })
    const refused = await expectJson(
      await rest.patch(`/api/v1/users/${person.principalId}`, {
        data: { attributes: { [key]: 'team' } },
      }),
      400
    )
    expect(refused.error.code).toBe('VALIDATION_ERROR')
    expect(refused.error.details.invalidAttributes).toEqual([
      { key, reason: `No attribute definition found for key '${key}'` },
    ])
    expect(await metadataOf(person.userUuid)).toMatchObject({ [key]: 'pro' })
    await rest.dispose()
  }
)

test(
  'PPL-U-56 attribute definitions need user_attribute.view to read and .manage to change',
  { tag: '@core' },
  async ({ playwright, marker, newTeammate }) => {
    const create = (k: string) => ({ key: k, label: `Label ${k}`, type: 'string' })
    const viewOnly = await newTeammate({
      roleKey: await createRole(marker, ['user_attribute.view']),
    })
    const contributor = await newTeammate({ roleKey: 'contributor' })
    const manager = await newTeammate({ roleKey: 'manager' })
    const existing = await seedUserAttribute('string')
    const id = fromDefinition((await definitionByKey(existing)).id as string)

    const c = await contributor.api(playwright)
    expect((await call(c, 'listUserAttributesFn')).ok).toBe(false)
    expect((await call(c, 'createUserAttributeFn', create(`c_${marker.slice(-8)}`))).ok).toBe(false)
    await c.dispose()

    const v = await viewOnly.api(playwright)
    expect((await call(v, 'listUserAttributesFn')).ok).toBe(true)
    const vKey = `v_${randomBytes(4).toString('hex')}`
    expect((await call(v, 'createUserAttributeFn', create(vKey))).ok).toBe(false)
    expect((await call(v, 'updateUserAttributeFn', { id, label: 'Changed' })).ok).toBe(false)
    expect((await call(v, 'deleteUserAttributeFn', { id })).ok).toBe(false)
    expect(await definitionByKey(vKey)).toBeUndefined()
    expect((await definitionByKey(existing)).label).toBe(existing)
    await v.dispose()

    const m = await manager.api(playwright)
    const mKey = `m_${randomBytes(4).toString('hex')}`
    await mustCall(m, 'createUserAttributeFn', create(mKey))
    await mustCall(m, 'updateUserAttributeFn', { id, label: `Changed ${marker}` })
    expect((await definitionByKey(existing)).label).toBe(`Changed ${marker}`)
    await mustCall(m, 'deleteUserAttributeFn', { id })
    expect(await definitionByKey(existing)).toBeUndefined()
    expect(await definitionByKey(mKey)).toBeDefined()
    await m.dispose()
  }
)
