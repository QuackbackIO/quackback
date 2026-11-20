/**
 * People over the REST API (/api/v1/users), the people server functions'
 * refusals and permission gates.
 *
 * Journeys: PPL-U-39, PPL-U-45, PPL-U-46, PPL-U-47, PPL-U-57, PPL-U-59,
 * PPL-U-60, PPL-U-61, PPL-U-64, PPL-U-65, PPL-U-66, PPL-U-69, PPL-U-70,
 * PPL-U-72
 */
import { generateId } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { createRole } from '../../support/access'
import { apiFor, createKey, expectJson } from '../../support/api-client'
import { supportEnv } from '../../support/env'
import {
  DELETED_USER_PRINCIPAL,
  auditRows,
  call,
  metadataOf,
  mustCall,
  personApi,
  portalUserRow,
  refusedCall,
  restAdmin,
  seedLead,
  seedUserAttribute,
  userRow,
  uuid,
} from '../../product/people'

/** User attribute writes on an existing user fail in user.identify.ts (QUARANTINE.md). */
const QUARANTINE_ATTR_WRITE = {
  tag: ['@core', '@quarantine'],
  annotation: {
    type: 'quarantine',
    description:
      'user.identify.ts builds the metadata update with ${metadataRemovals}::text[], which drizzle expands to () or ($n), so every attribute or externalId write on an existing user is a 500; see QUARANTINE.md',
  },
} as const

test.describe('blocking: refusals', () => {
  test(
    'PPL-U-39 block is refused for a teammate, a service principal and an unknown id; a lead can be blocked',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      const admin = await personApi(playwright, 'admin')
      const sql = supportDb()
      const mate = await newTeammate({ roleKey: 'contributor' })
      const service = createKey({
        creatorEmail: 'e2e-support-admin@example.com',
        kind: 'workspace',
        roleKey: 'contributor',
      })
      const cases: Array<[string, string[]]> = [
        [mate.principalId, ['CANNOT_BLOCK_TEAM']],
        // A workspace key's principal holds a team role, so the team guard
        // answers before the service guard (blocking.ts assertBlockable).
        [service.principalId, ['CANNOT_BLOCK_TEAM', 'CANNOT_BLOCK_SERVICE']],
        [generateId('principal'), ['PRINCIPAL_NOT_FOUND']],
      ]
      for (const [principalId, codes] of cases) {
        const res = await refusedCall(admin, 'blockPersonFn', { principalId })
        expect(codes, principalId).toContain(res.code)
      }
      const blocked = await sql`SELECT id FROM principal WHERE blocked_at IS NOT NULL
        AND id IN ${sql([uuid(mate.principalId), uuid(service.principalId)])}`
      expect(blocked).toHaveLength(0)

      const lead = await seedLead(marker)
      await mustCall(admin, 'blockPersonFn', { principalId: lead.principalId })
      const [row] = await sql`SELECT blocked_at FROM principal WHERE id = ${lead.principalUuid}`
      expect(row.blocked_at).not.toBeNull()
      await admin.dispose()
    }
  )
})

test.describe('people permissions', () => {
  test(
    'PPL-U-46 a people.view-only teammate reads people but every people write is refused',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      const mate = await newTeammate({ roleKey: 'contributor' })
      const api = await mate.api(playwright)
      const person = await portalUserRow(marker)
      const lead = await seedLead(marker, { contactEmail: person.email })
      const target = { principalId: person.principalId }

      for (const [name, data] of [
        ['listPortalUsersFn', { search: marker }],
        ['getPortalUserFn', target],
        ['listDuplicateUsersFn', target],
        ['listUserTagsFn', undefined],
        ['getPersonBlockStatusFn', target],
        ['getChangelogSubscriptionStatusFn', target],
      ] as const) {
        const res = await call(api, name, data)
        expect(res.ok, `${name}: ${res.raw.slice(0, 200)}`).toBe(true)
      }

      for (const [name, data] of [
        ['updatePortalUserFn', { ...target, name: `Hijack ${marker}` }],
        ['createPortalUserFn', { name: `New ${marker}`, email: `${marker}-new@customers.example` }],
        ['findPortalUsersByEmailFn', { email: person.email }],
        ['deletePortalUserFn', target],
        [
          'mergeLeadIntoUserFn',
          { principalId: lead.principalId, targetPrincipalId: person.principalId },
        ],
        ['assignUserTagFn', { ...target, name: `tag-${marker}` }],
        ['removeUserTagFn', { ...target, tagId: generateId('user_tag') }],
        ['blockPersonFn', target],
        ['unblockPersonFn', target],
        ['setChangelogSubscriptionFn', { ...target, subscribed: true }],
      ] as const) {
        const res = await call(api, name, data)
        expect(res.ok, `${name} must be refused`).toBe(false)
      }

      const row = await userRow(person.userUuid)
      expect(row.name).toBe(person.name)
      const sql = supportDb()
      const [principal] =
        await sql`SELECT blocked_at FROM principal WHERE id = ${person.principalUuid}`
      expect(principal.blocked_at).toBeNull()
      const [leadRow] = await sql`SELECT id FROM principal WHERE id = ${lead.principalUuid}`
      expect(leadRow, 'the lead was not merged').toBeDefined()
      const created =
        await sql`SELECT id FROM "user" WHERE email = ${`${marker}-new@customers.example`}`
      expect(created).toHaveLength(0)
      const tagged = await sql`SELECT t.id FROM user_tags t WHERE t.name = ${`tag-${marker}`}`
      expect(tagged).toHaveLength(0)
      await api.dispose()
    }
  )

  test(
    'PPL-U-47 a teammate without people.view gets nothing from people reads',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      const roleKey = await createRole(marker, ['conversation.view', 'member.view'])
      const mate = await newTeammate({ roleKey })
      const api = await mate.api(playwright)
      const person = await portalUserRow(marker)
      const target = { principalId: person.principalId }
      for (const [name, data] of [
        ['listPortalUsersFn', { search: marker }],
        ['getPortalUserFn', target],
        ['getPersonBlockStatusFn', target],
        ['getProfileTeamContextFn', target],
        ['searchPeopleFn', { search: marker }],
      ] as const) {
        const res = await call(api, name, data)
        expect(res.ok, `${name} must be refused: ${res.raw.slice(0, 200)}`).toBe(false)
        expect(res.raw, name).not.toContain(person.email)
      }
      await api.dispose()
    }
  )
})

test.describe('removing people: refusals', () => {
  test(
    'PPL-U-45 remove is refused for a teammate, the placeholder, an unknown id and a repeat',
    { tag: '@core' },
    async ({ playwright, people, marker, newTeammate }) => {
      const admin = await personApi(playwright, 'admin')
      const sql = supportDb()
      const mate = await newTeammate({ roleKey: 'contributor' })
      const person = await portalUserRow(marker)

      const refusals = [
        mate.principalId,
        people.people.agentB.principalId,
        DELETED_USER_PRINCIPAL,
        generateId('principal'),
      ]
      for (const principalId of refusals) {
        const res = await refusedCall(admin, 'deletePortalUserFn', { principalId })
        expect(res.code, principalId).toBe('MEMBER_NOT_FOUND')
      }
      const [mateRow] = await sql`SELECT role FROM principal WHERE user_id =
        (SELECT id FROM "user" WHERE email = ${mate.email})`
      expect(mateRow?.role).toBe('member')

      // A real removal, then the repeat is refused.
      await mustCall(admin, 'deletePortalUserFn', { principalId: person.principalId })
      const again = await refusedCall(admin, 'deletePortalUserFn', {
        principalId: person.principalId,
      })
      expect(again.code).toBe('MEMBER_NOT_FOUND')

      // An anonymous lead can be removed; its synthetic user row stays.
      const lead = await seedLead(marker, { contactEmail: `${marker}-lead@customers.example` })
      await mustCall(admin, 'deletePortalUserFn', { principalId: lead.principalId })
      const [leadPrincipal] = await sql`SELECT id FROM principal WHERE id = ${lead.principalUuid}`
      expect(leadPrincipal).toBeUndefined()
      const [leadUser] = await sql`SELECT id FROM "user" WHERE id = ${lead.userUuid}`
      expect(leadUser).toBeDefined()
      await admin.dispose()
    }
  )
})

test.describe('REST /api/v1/users', () => {
  test(
    'PPL-U-57 list users returns identified portal users only, with counts and paging',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      const rest = await restAdmin(playwright)
      const a = await portalUserRow(marker)
      const b = await portalUserRow(marker)
      await supportDb()`UPDATE "user" SET metadata = ${JSON.stringify({ plan: 'pro', _secret: 'x' })}
                        WHERE id = ${a.userUuid}`
      // Not listed: a lead and a teammate carrying the marker.
      const lead = await seedLead(marker, { name: `Lead ${marker}` })
      const mate = await newTeammate({ roleKey: 'contributor', name: `Mate ${marker}` })

      const body = await expectJson(
        await rest.get(`/api/v1/users?search=${encodeURIComponent(marker)}&limit=1`),
        200
      )
      expect(body.data).toHaveLength(1)
      expect(body.meta.pagination.hasMore).toBe(true)
      expect(body.meta.pagination.total).toBe(2)
      const next = await expectJson(
        await rest.get(
          `/api/v1/users?search=${encodeURIComponent(marker)}&limit=1&cursor=${body.meta.pagination.cursor}`
        ),
        200
      )
      expect(next.data).toHaveLength(1)
      expect(next.meta.pagination.hasMore).toBe(false)

      const all = [...body.data, ...next.data]
      const ids = all.map((u: { principalId: string }) => u.principalId).sort()
      expect(ids).toEqual([a.principalId, b.principalId].sort())
      expect(ids).not.toContain(lead.principalId)
      expect(ids).not.toContain(mate.principalId)

      const rowA = all.find((u: { principalId: string }) => u.principalId === a.principalId)
      expect(rowA).toMatchObject({
        userId: a.userId,
        name: a.name,
        email: a.email,
        emailVerified: true,
        attributes: { plan: 'pro' },
        postCount: 0,
        commentCount: 0,
        voteCount: 0,
      })
      expect(rowA.attributes).not.toHaveProperty('_secret')
      expect(typeof rowA.joinedAt).toBe('string')
      await rest.dispose()
    }
  )

  test(
    'PPL-U-59 get one user: profile fields, a lead without an email, refusals',
    { tag: '@core' },
    async ({ playwright, marker }) => {
      const rest = await restAdmin(playwright)
      const person = await portalUserRow(marker)
      const lead = await seedLead(marker)

      const one = await expectJson(await rest.get(`/api/v1/users/${person.principalId}`), 200)
      expect(one.data).toMatchObject({
        principalId: person.principalId,
        userId: person.userId,
        name: person.name,
        email: person.email,
        emailVerified: true,
        postCount: 0,
        commentCount: 0,
        voteCount: 0,
        engagedPosts: [],
      })
      expect(typeof one.data.createdAt).toBe('string')

      const leadBody = await expectJson(await rest.get(`/api/v1/users/${lead.principalId}`), 200)
      expect(leadBody.data.email).toBeNull()

      const bad = await expectJson(await rest.get('/api/v1/users/not-a-principal'), 400)
      expect(bad.error.code).toBe('VALIDATION_ERROR')
      expect(bad.error.message).toContain('Invalid principal ID format')
      await rest.dispose()
    }
  )

  test(
    'PPL-U-59 a teammate id answers a plain "Portal user not found"',
    {
      tag: '@core',
    },
    async ({ playwright, people }) => {
      const rest = await restAdmin(playwright)
      const res = await expectJson(
        await rest.get(`/api/v1/users/${people.people.agentB.principalId}`),
        404
      )
      expect(res.error.code).toBe('NOT_FOUND')
      expect(res.error.message).toBe('Portal user not found')
      await rest.dispose()
    }
  )

  test(
    'PPL-U-64 delete a user over REST, then the repeat is a 404',
    { tag: '@core' },
    async ({ playwright, marker }) => {
      const rest = await restAdmin(playwright)
      const person = await portalUserRow(marker)
      const res = await rest.delete(`/api/v1/users/${person.principalId}`)
      expect(res.status(), await res.text()).toBe(204)
      const [row] = await supportDb()`SELECT id FROM principal WHERE id = ${person.principalUuid}`
      expect(row).toBeUndefined()
      const again = await expectJson(await rest.delete(`/api/v1/users/${person.principalId}`), 404)
      expect(again.error.code).toBe('NOT_FOUND')
      await rest.dispose()
    }
  )

  test(
    'PPL-U-64 an unknown or teammate id is refused as a missing user, not a "Member"',
    {
      tag: ['@core', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'removePortalUser throws MEMBER_NOT_FOUND, which handleDomainError names "Member not found" on the users endpoint; see QUARANTINE.md',
      },
    },
    async ({ playwright, people }) => {
      const rest = await restAdmin(playwright)
      for (const id of [generateId('principal'), people.people.agentB.principalId]) {
        const res = await expectJson(await rest.delete(`/api/v1/users/${id}`), 404)
        expect(res.error.message, id).not.toContain('Member')
        expect(res.error.message, id).toMatch(/user not found/i)
      }
      await rest.dispose()
    }
  )

  test(
    'PPL-U-60 PATCH a user name and image; a teammate id is refused',
    { tag: '@core' },
    async ({ playwright, people, marker }) => {
      const rest = await restAdmin(playwright)
      const person = await portalUserRow(marker)
      const body = await expectJson(
        await rest.patch(`/api/v1/users/${person.principalId}`, {
          data: { name: `Patched ${marker}`, image: 'https://images.example/avatar.png' },
        }),
        200
      )
      expect(body.data).toMatchObject({
        principalId: person.principalId,
        name: `Patched ${marker}`,
        image: 'https://images.example/avatar.png',
        email: person.email,
      })
      expect((await userRow(person.userUuid)).name).toBe(`Patched ${marker}`)
      const [principal] = await supportDb()`SELECT display_name, avatar_url FROM principal
        WHERE id = ${person.principalUuid}`
      expect(principal.display_name).toBe(`Patched ${marker}`)

      const mate = await expectJson(
        await rest.patch(`/api/v1/users/${people.people.agentB.principalId}`, {
          data: { name: `Hijack ${marker}` },
        }),
        404
      )
      expect(mate.error.message).toBe('Member not found')
      await rest.dispose()
    }
  )

  test(
    'PPL-U-60 PATCH merges coerced attributes, unsets null keys and sets the external id',
    QUARANTINE_ATTR_WRITE,
    async ({ playwright, marker }) => {
      const rest = await restAdmin(playwright)
      const plan = await seedUserAttribute('string')
      const seats = await seedUserAttribute('number')
      const old = await seedUserAttribute('string')
      const person = await portalUserRow(marker)
      await supportDb()`UPDATE "user" SET metadata = ${JSON.stringify({ [old]: 'gone soon' })}
                        WHERE id = ${person.userUuid}`

      const body = await expectJson(
        await rest.patch(`/api/v1/users/${person.principalId}`, {
          data: {
            externalId: `ext-${marker}`,
            attributes: { [plan]: 'pro', [seats]: '5', [old]: null },
          },
        }),
        200
      )
      expect(body.data.externalId).toBe(`ext-${marker}`)
      const meta = await metadataOf(person.userUuid)
      expect(meta[plan]).toBe('pro')
      expect(meta[seats]).toBe(5)
      expect(meta).not.toHaveProperty(old)
      expect(meta._externalUserId).toBe(`ext-${marker}`)

      await expectJson(
        await rest.patch(`/api/v1/users/${person.principalId}`, { data: { externalId: null } }),
        200
      )
      expect(await metadataOf(person.userUuid)).not.toHaveProperty('_externalUserId')
      await rest.dispose()
    }
  )

  test(
    'PPL-U-61 attribute and body validation refuses the whole request and writes nothing',
    { tag: '@core' },
    async ({ playwright, marker }) => {
      const rest = await restAdmin(playwright)
      const num = await seedUserAttribute('number')
      const bool = await seedUserAttribute('boolean')
      const date = await seedUserAttribute('date')
      const text = await seedUserAttribute('string')
      const person = await portalUserRow(marker)
      const patch = (data: unknown) => rest.patch(`/api/v1/users/${person.principalId}`, { data })

      const unknown = await expectJson(
        await patch({ attributes: { [text]: 'kept?', nope_not_defined: 'x' } }),
        400
      )
      expect(unknown.error.code).toBe('VALIDATION_ERROR')
      expect(unknown.error.message).toBe('One or more user attributes are invalid')
      expect(JSON.stringify(unknown.error.details)).toContain(
        "No attribute definition found for key 'nope_not_defined'"
      )

      const badNumber = await expectJson(await patch({ attributes: { [num]: 'abc' } }), 400)
      expect(JSON.stringify(badNumber.error.details)).toContain(
        "Value 'abc' cannot be coerced to type 'number'"
      )
      await expectJson(await patch({ attributes: { [bool]: 'yes' } }), 400)
      await expectJson(await patch({ attributes: { [date]: 'not a date' } }), 400)
      expect(await metadataOf(person.userUuid), 'no partial write').toEqual({})

      const schema = await expectJson(
        await patch({ name: 'x'.repeat(201), image: 'not a url' }),
        400
      )
      expect(schema.error.code).toBe('BAD_REQUEST')
      expect(schema.error.message).toBe('Invalid request body')
      expect(Object.keys(schema.error.details.errors).sort()).toEqual(['image', 'name'])
      expect((await userRow(person.userUuid)).name).toBe(person.name)
      await rest.dispose()
    }
  )

  test(
    'PPL-U-61 boolean and date attributes accept their valid spellings',
    QUARANTINE_ATTR_WRITE,
    async ({ playwright, marker }) => {
      const rest = await restAdmin(playwright)
      const bool = await seedUserAttribute('boolean')
      const date = await seedUserAttribute('date')
      const person = await portalUserRow(marker)
      const patch = (data: unknown) => rest.patch(`/api/v1/users/${person.principalId}`, { data })
      for (const value of ['true', '1', 'false', '0']) {
        await expectJson(await patch({ attributes: { [bool]: value } }), 200)
      }
      expect((await metadataOf(person.userUuid))[bool]).toBe(false)
      await expectJson(await patch({ attributes: { [date]: '2026-01-02' } }), 200)
      expect((await metadataOf(person.userUuid))[date]).toBe('2026-01-02T00:00:00.000Z')
      await rest.dispose()
    }
  )

  test(
    'PPL-U-65 identify creates a portal user, auditing only an asserted verification',
    { tag: '@core' },
    async ({ playwright, marker }) => {
      const rest = await restAdmin(playwright)
      const plan = await seedUserAttribute('string')
      const email = `${marker}-New@Customers.Example`

      const created = await expectJson(
        await rest.post('/api/v1/users/identify', {
          data: { email, attributes: { [plan]: 'team' }, externalId: `ext-${marker}` },
        }),
        201
      )
      expect(created.data).toMatchObject({
        name: `${marker}-new`,
        email: email.toLowerCase(),
        emailVerified: false,
        externalId: `ext-${marker}`,
        attributes: { [plan]: 'team' },
        created: true,
      })
      const [principal] = await supportDb()`SELECT role FROM principal
        WHERE id = ${uuid(created.data.principalId)}`
      expect(principal.role).toBe('user')
      expect(await auditRows('user.email_verified.asserted', created.data.userId)).toEqual([])

      const verified = await expectJson(
        await rest.post('/api/v1/users/identify', {
          data: { email: `${marker}-v@customers.example`, emailVerified: true },
        }),
        201
      )
      expect(verified.data.emailVerified).toBe(true)
      const [audit] = await auditRows('user.email_verified.asserted', verified.data.userId)
      expect(audit.before_value).toBeNull()
      expect(audit.after_value).toEqual({ emailVerified: true })
      expect(audit.metadata).toMatchObject({
        source: 'api.users.identify',
        apiKeyId: expect.any(String),
        created: true,
      })
      await rest.dispose()
    }
  )

  test(
    'PPL-U-66 identify updates an existing user and audits only a true-over-false flip',
    { tag: '@core' },
    async ({ playwright, marker }) => {
      const rest = await restAdmin(playwright)
      const person = await portalUserRow(marker, { verified: false })

      const res = await expectJson(
        await rest.post('/api/v1/users/identify', {
          data: {
            email: person.email,
            name: `Identified ${marker}`,
            image: 'https://images.example/i.png',
          },
        }),
        200
      )
      expect(res.data).toMatchObject({ created: false, name: `Identified ${marker}` })
      expect((await userRow(person.userUuid)).email_verified).toBe(false)
      const [principal] = await supportDb()`SELECT display_name FROM principal
        WHERE id = ${person.principalUuid}`
      expect(principal.display_name).toBe(`Identified ${marker}`)

      await expectJson(
        await rest.post('/api/v1/users/identify', {
          data: { email: person.email, emailVerified: true },
        }),
        200
      )
      const audits = await auditRows('user.email_verified.asserted', person.userId)
      expect(audits).toHaveLength(1)
      expect(audits[0].before_value).toEqual({ emailVerified: false })

      await expectJson(
        await rest.post('/api/v1/users/identify', {
          data: { email: person.email, emailVerified: false },
        }),
        200
      )
      expect((await userRow(person.userUuid)).email_verified).toBe(false)
      expect(await auditRows('user.email_verified.asserted', person.userId)).toHaveLength(1)
      await rest.dispose()
    }
  )

  test(
    'PPL-U-66 identify merges an attribute into an existing user, keeping the others',
    QUARANTINE_ATTR_WRITE,
    async ({ playwright, marker }) => {
      const rest = await restAdmin(playwright)
      const plan = await seedUserAttribute('string')
      const tier = await seedUserAttribute('string')
      const person = await portalUserRow(marker)
      await supportDb()`UPDATE "user" SET metadata = ${JSON.stringify({ [tier]: 'gold' })}
                        WHERE id = ${person.userUuid}`
      await expectJson(
        await rest.post('/api/v1/users/identify', {
          data: { email: person.email, attributes: { [plan]: 'pro' } },
        }),
        200
      )
      expect(await metadataOf(person.userUuid)).toMatchObject({ [plan]: 'pro', [tier]: 'gold' })
      await rest.dispose()
    }
  )

  test(
    'PPL-U-69 identify refuses bad bodies and creates nobody',
    { tag: '@nightly' },
    async ({ playwright, marker }) => {
      const rest = await restAdmin(playwright)
      const missing = await expectJson(
        await rest.post('/api/v1/users/identify', { data: { email: 'nope' } }),
        400
      )
      expect(missing.error.code).toBe('BAD_REQUEST')
      expect(missing.error.details.errors.email).toEqual(['Valid email is required'])
      const email = `${marker}@customers.example`
      await expectJson(
        await rest.post('/api/v1/users/identify', {
          data: { email, externalId: 'x'.repeat(256) },
        }),
        400
      )
      await expectJson(
        await rest.post('/api/v1/users/identify', { data: { email, image: 'not a url' } }),
        400
      )
      const unknown = await expectJson(
        await rest.post('/api/v1/users/identify', {
          data: { email, attributes: { not_defined_anywhere: 1 } },
        }),
        400
      )
      expect(unknown.error.code).toBe('VALIDATION_ERROR')
      const made = await supportDb()`SELECT id FROM "user" WHERE email = ${email}`
      expect(made).toHaveLength(0)
      await rest.dispose()
    }
  )

  test(
    'PPL-U-69 a body that is not JSON is a 400, not a server error',
    { tag: '@nightly' },
    async ({ playwright }) => {
      const rest = await restAdmin(playwright)
      const res = await rest.post('/api/v1/users/identify', {
        headers: { 'content-type': 'application/json' },
        data: '{not json',
      })
      expect(res.status(), await res.text()).toBe(400)
      await rest.dispose()
    }
  )

  test(
    'PPL-U-70 API key authority on the users endpoints',
    { tag: '@core' },
    async ({ playwright, people, marker }) => {
      const base = supportEnv().baseUrl
      const keyed = (key: string | null) => apiFor(playwright, base, key)
      const contributorKey = createKey({ creatorEmail: people.people.contributor.email })
      const readOnly = createKey({
        creatorEmail: people.people.admin.email,
        scopes: ['read:feedback'],
      })
      const legacy = createKey({ creatorEmail: people.people.admin.email, legacy: true })
      const adminKey = createKey({ creatorEmail: people.people.admin.email })

      for (const [key, writeMessage] of [
        [contributorKey.key, "Requires the 'people.manage' permission"],
        [
          readOnly.key,
          "This API key is missing the 'write:feedback' scope required by 'people.manage'",
        ],
      ] as const) {
        const api = await keyed(key)
        await expectJson(await api.get(`/api/v1/users?search=${marker}`), 200)
        const person = await portalUserRow(marker)
        const patch = await expectJson(
          await api.patch(`/api/v1/users/${person.principalId}`, { data: { name: 'x' } }),
          403
        )
        expect(patch.error.code).toBe('FORBIDDEN')
        expect(patch.error.message).toBe(writeMessage)
        await expectJson(await api.delete(`/api/v1/users/${person.principalId}`), 403)
        await expectJson(
          await api.post('/api/v1/users/identify', {
            data: { email: `${marker}-${Date.now()}@customers.example` },
          }),
          403
        )
        expect((await userRow(person.userUuid)).name).toBe(person.name)
        await api.dispose()
      }

      for (const key of [adminKey.key, legacy.key]) {
        const api = await keyed(key)
        const person = await portalUserRow(marker)
        await expectJson(
          await api.patch(`/api/v1/users/${person.principalId}`, {
            data: { name: `By key ${marker}` },
          }),
          200
        )
        const del = await api.delete(`/api/v1/users/${person.principalId}`)
        expect(del.status()).toBe(204)
        await api.dispose()
      }

      for (const key of [null, 'qb_' + '0'.repeat(48)]) {
        const api = await keyed(key)
        const res = await api.get('/api/v1/users')
        expect(res.status()).toBe(401)
        expect(res.headers()['www-authenticate']).toBe('Bearer realm="Quackback API"')
        expect((await res.json()).error.code).toBe('UNAUTHORIZED')
        await api.dispose()
      }
    }
  )
})

test.describe('CSV export', () => {
  test(
    'PPL-U-72 the users export carries the filtered directory; no people.view, no file',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      const admin = await personApi(playwright, 'admin')
      const person = await portalUserRow(marker)
      const lead = await seedLead(marker, { contactEmail: `${marker}-lead@customers.example` })

      const res = await admin.get(`/api/export/users?search=${encodeURIComponent(marker)}`)
      expect(res.status()).toBe(200)
      expect(res.headers()['content-type']).toContain('text/csv')
      expect(res.headers()['content-disposition']).toMatch(
        /^attachment; filename="users-export-[a-z0-9-]+-\d+\.csv"$/
      )
      const lines = (await res.text()).trim().split('\n')
      expect(lines[0]).toBe(
        'name,email,verified,lifecycle,segments,joined_at,last_seen_at,post_count,comment_count,vote_count'
      )
      expect(lines).toHaveLength(2)
      expect(lines[1]).toContain(person.email)

      const leads = await admin.get(
        `/api/export/users?search=${encodeURIComponent(marker)}&lifecycle=leads`
      )
      const leadLines = (await leads.text()).trim().split('\n')
      expect(leadLines).toHaveLength(2)
      expect(leadLines[1]).toContain(`${marker}-lead@customers.example`)
      expect(leadLines[1]).toContain(',lead,')
      expect(leadLines[1]).not.toContain(lead.email)
      await admin.dispose()

      const roleKey = await createRole(marker, ['conversation.view'])
      const mate = await newTeammate({ roleKey })
      const api = await mate.api(playwright)
      const denied = await api.get(`/api/export/users?search=${encodeURIComponent(marker)}`)
      expect(denied.status()).toBe(403)
      expect(await denied.json()).toEqual({ error: 'Access denied' })
      await api.dispose()
    }
  )
})
