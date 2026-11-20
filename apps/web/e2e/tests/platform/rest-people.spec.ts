/**
 * The REST API for people: portal users (/users), companies, segment members
 * and teammates (/principals, /members). Journeys API-R-139..API-R-160.
 *
 * Every key is made per test and every request context has its own client
 * address. Role changes and removals only ever touch a teammate this test
 * made (`newTeammate`), never the shared people.
 *
 * Not here: API-R-145, API-R-156 and API-R-159 are owner questions (identify
 * rewriting a teammate, REST members on a dynamic segment, a personal key
 * changing its own creator). The seat-limit 402 and the last-admin cases of
 * API-R-158 and API-R-160 need a single-admin or seat-capped workspace.
 */
import { generateId, toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import {
  apiFor,
  createKey,
  eventsFor,
  expectJson,
  newTeammate as customTeammate,
  seedConv,
  type Wire,
} from '../../support/api-client'
import { mintCustomer } from '../../support/widget-portal'
import { mintSession } from '../../support/teammates'
import {
  UNAUTHORIZED_MESSAGE,
  auditRows,
  customRoleKey,
  expectForbidden,
  identify,
  keyApi,
  makeBoard,
  makeBoardTeamOnly,
  makePost,
  principalRole,
  roleIdOf,
  seedSegment,
  segmentRows,
  sessionApi,
} from '../../product/api-rest-keys'

test.describe.configure({ timeout: 60_000 })

const USER_KEYS = [
  'attributes',
  'commentCount',
  'email',
  'emailVerified',
  'image',
  'joinedAt',
  'name',
  'postCount',
  'principalId',
  'userId',
  'voteCount',
]
const PROFILE_KEYS = [
  'attributes',
  'createdAt',
  'email',
  'emailVerified',
  'externalId',
  'image',
  'name',
  'principalId',
  'userId',
]
const MEMBER_KEYS = ['createdAt', 'email', 'id', 'image', 'name', 'role', 'userId']
const COMPANY_KEYS = [
  'createdAt',
  'customAttributes',
  'domain',
  'externalId',
  'id',
  'industry',
  'memberCount',
  'mrrCents',
  'name',
  'plan',
  'size',
  'source',
  'updatedAt',
  'website',
]
const DELETED_USER = 'principal_00000000000000000000000000'

const ids = (body: Wire, field = 'principalId'): string[] =>
  body.data.map((row: Record<string, string>) => row[field])

/** A company with `members` portal users attached, straight in the database. */
async function seedCompany(
  marker: string,
  suffix: string,
  members: string[] = []
): Promise<{ id: string; externalId: string; name: string }> {
  const typeId = generateId('company')
  const name = `Co ${suffix} ${marker}`
  const externalId = `ext-${suffix}-${marker}`
  await supportDb()`INSERT INTO companies (id, name, external_id, plan, source)
                    VALUES (${toUuid(typeId)}, ${name}, ${externalId}, 'pro', 'api')`
  for (const principalId of members) {
    await supportDb()`UPDATE principal SET company_id = ${toUuid(typeId)}
                      WHERE id = ${toUuid(principalId as `principal_${string}`)}`
  }
  return { id: typeId, externalId, name }
}

test.describe('REST portal users', () => {
  test(
    'API-R-139 list portal users: shape, total and filters; teammates never appear',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker, newTeammate }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
        roleKey: 'owner',
      })
      // A teammate whose email holds the marker: a leak would match the search.
      const mate = await newTeammate({ roleKey: 'manager' })
      expect(mate.email).toContain(marker)
      const a = await identify(admin.api, `${marker}-a@customers.example`, {
        name: `Alpha ${marker}`,
        emailVerified: true,
      })
      const b = await identify(admin.api, `${marker}-b@customers.example`, {
        name: `Beta ${marker}`,
      })
      const seg = await seedSegment(marker)
      await supportDb()`INSERT INTO user_segments (principal_id, segment_id, added_by)
                        VALUES (${toUuid(a.principalId)}, ${seg.uuid}, 'manual')`

      const list = await expectJson(await admin.api.get(`/api/v1/users?search=${marker}`), 200)
      // Newest first by default.
      expect(ids(list)).toEqual([b.principalId, a.principalId])
      expect(list.meta.pagination).toEqual({ cursor: null, hasMore: false, total: 2 })
      const alpha = list.data.find((u: Wire) => u.principalId === a.principalId)
      expect(Object.keys(alpha).sort()).toEqual(USER_KEYS)
      expect(alpha).toMatchObject({
        userId: a.userId,
        name: `Alpha ${marker}`,
        email: `${marker}-a@customers.example`,
        emailVerified: true,
        attributes: {},
        postCount: 0,
        commentCount: 0,
        voteCount: 0,
      })

      const byName = await expectJson(
        await admin.api.get(`/api/v1/users?search=${marker}&sort=name`),
        200
      )
      expect(ids(byName)).toEqual([a.principalId, b.principalId])
      const verified = await expectJson(
        await admin.api.get(`/api/v1/users?search=${marker}&verified=true`),
        200
      )
      expect(ids(verified)).toEqual([a.principalId])
      const unverified = await expectJson(
        await admin.api.get(`/api/v1/users?search=${marker}&verified=false`),
        200
      )
      expect(ids(unverified)).toEqual([b.principalId])
      const inSegment = await expectJson(
        await admin.api.get(`/api/v1/users?search=${marker}&segmentIds=${seg.id}`),
        200
      )
      expect(ids(inSegment)).toEqual([a.principalId])

      // The teammate and the deleted-user placeholder are not portal users.
      expect(
        (await admin.api.get(`/api/v1/users/${mate.principalId}`)).status(),
        'a teammate is not a portal user'
      ).toBe(404)
      expect((await admin.api.get(`/api/v1/users/${DELETED_USER}`)).status()).toBe(404)
      await admin.api.dispose()
    }
  )

  test(
    'API-R-140 users paging continues by offset; bad limits never answer 500',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
        roleKey: 'owner',
      })
      const made: string[] = []
      for (const n of [1, 2, 3]) {
        made.push((await identify(admin.api, `${marker}-${n}@customers.example`)).principalId)
      }
      const first = await expectJson(
        await admin.api.get(`/api/v1/users?search=${marker}&limit=2`),
        200
      )
      expect(first.data).toHaveLength(2)
      expect(first.meta.pagination).toMatchObject({ hasMore: true, total: 3 })
      expect(first.meta.pagination.cursor).toEqual(expect.any(String))
      const second = await expectJson(
        await admin.api.get(
          `/api/v1/users?search=${marker}&limit=2&cursor=${first.meta.pagination.cursor}`
        ),
        200
      )
      expect(second.meta.pagination).toEqual({ cursor: null, hasMore: false, total: 3 })
      expect([...ids(first), ...ids(second)].sort()).toEqual([...made].sort())

      for (const limit of ['0', 'abc']) {
        const res = await admin.api.get(`/api/v1/users?search=${marker}&limit=${limit}`)
        expect(res.status(), `limit=${limit}: ${await res.text()}`).toBeLessThan(500)
      }
      await admin.api.dispose()
    }
  )

  test(
    'API-R-140 a malformed segmentIds filter is a clean 4xx, not a 500',
    {
      tag: ['@nightly', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'segmentIds is not validated and reaches inArray on a typeid column: 500 (routes/api/v1/users/index.ts:41-44, users/user.service.ts:306-313)',
      },
    },
    async ({ playwright, baseURL, people }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
        roleKey: 'owner',
      })
      const res = await admin.api.get('/api/v1/users?segmentIds=not-an-id')
      const status = res.status()
      expect(status, await res.text()).toBeGreaterThanOrEqual(400)
      expect(status).toBeLessThan(500)
      await admin.api.dispose()
    }
  )

  test(
    'API-R-141 get one portal user with engaged posts, private boards included; refusals',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker, newTeammate }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
        roleKey: 'owner',
      })
      const user = await identify(admin.api, `${marker}@customers.example`, { name: marker })
      const board = await makeBoard(admin.api, marker)
      const postId = await makePost(admin.api, board, `Post ${marker}`, {
        authorPrincipalId: user.principalId,
      })
      await makeBoardTeamOnly(board)

      const body = await expectJson(await admin.api.get(`/api/v1/users/${user.principalId}`), 200)
      expect(body.data).toMatchObject({
        principalId: user.principalId,
        userId: user.userId,
        email: `${marker}@customers.example`,
        postCount: 1,
      })
      const engaged = body.data.engagedPosts.find((p: Wire) => p.id === postId)
      expect(engaged, 'the post on a team-only board is listed').toBeTruthy()
      expect(Object.keys(engaged).sort()).toEqual(
        [
          'authorName',
          'boardName',
          'boardSlug',
          'commentCount',
          'content',
          'createdAt',
          'engagedAt',
          'engagementTypes',
          'id',
          'statusColor',
          'statusId',
          'statusName',
          'title',
          'voteCount',
        ].sort()
      )
      expect(engaged).toMatchObject({ title: `Post ${marker}`, boardName: `Board ${marker}` })

      const mate = await newTeammate({ roleKey: 'manager' })
      for (const id of [mate.principalId, generateId('principal')]) {
        const missing = await expectJson(await admin.api.get(`/api/v1/users/${id}`), 404)
        expect(missing.error.code).toBe('NOT_FOUND')
      }
      const malformed = await expectJson(await admin.api.get('/api/v1/users/not-an-id'), 400)
      expect(malformed.error).toEqual({
        code: 'VALIDATION_ERROR',
        message: 'Invalid principal ID format',
      })
      await admin.api.dispose()
    }
  )

  test(
    'API-R-141 a missing portal user says "Portal user not found"',
    {
      tag: ['@core', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'notFoundResponse appends " not found" to "Portal user not found": "Portal user not found not found" (routes/api/v1/users/$principalId.ts:46)',
      },
    },
    async ({ playwright, baseURL, people }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
        roleKey: 'owner',
      })
      const body = await expectJson(
        await admin.api.get(`/api/v1/users/${generateId('principal')}`),
        404
      )
      expect(body.error).toEqual({ code: 'NOT_FOUND', message: 'Portal user not found' })
      await admin.api.dispose()
    }
  )

  test(
    'API-R-142 identify creates a portal user, then updates the same one',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
        roleKey: 'owner',
      })
      const mixed = `${marker}-Mixed@Customers.Example`
      const res = await admin.api.post('/api/v1/users/identify', {
        data: { email: mixed, name: `First ${marker}` },
      })
      const created = (await expectJson(res, 201)).data
      expect(Object.keys(created).sort()).toEqual([...PROFILE_KEYS, 'created'].sort())
      expect(created).toMatchObject({
        email: mixed.toLowerCase(),
        name: `First ${marker}`,
        emailVerified: false,
        externalId: null,
        attributes: {},
        created: true,
      })
      expect(await principalRole(created.principalId)).toBe('user')

      const again = await identify(admin.api, mixed, { name: `Second ${marker}` }, 200)
      expect(again).toMatchObject({
        created: false,
        principalId: created.principalId,
        userId: created.userId,
        name: `Second ${marker}`,
      })
      const [row] = await supportDb()`SELECT display_name FROM principal
                                      WHERE id = ${toUuid(created.principalId)}`
      expect(row.display_name).toBe(`Second ${marker}`)

      const nameless = await identify(admin.api, `${marker}-nameless@customers.example`)
      expect(nameless.name).toBe(`${marker}-nameless`)
      // Identify sends nothing: no event names the new person.
      expect(await eventsFor(created.userId)).toEqual([])
      expect(await eventsFor(created.principalId)).toEqual([])
      await admin.api.dispose()
    }
  )

  test(
    'API-R-143 asserting a verified email over identify is audited once',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
        roleKey: 'owner',
      })
      const fresh = await identify(admin.api, `${marker}-v@customers.example`, {
        emailVerified: true,
      })
      const later = await identify(admin.api, `${marker}-l@customers.example`)
      await identify(admin.api, `${marker}-l@customers.example`, { emailVerified: true }, 200)
      // Already verified: no second row.
      await identify(admin.api, `${marker}-l@customers.example`, { emailVerified: true }, 200)

      const freshRows = await auditRows('user.email_verified.asserted', fresh.userId)
      expect(freshRows).toHaveLength(1)
      expect(freshRows[0]).toMatchObject({
        actor_type: 'api_key',
        target_type: 'user',
        before_value: null,
        after_value: { emailVerified: true },
        metadata: { source: 'api.users.identify', apiKeyId: admin.id, created: true },
      })
      const laterRows = await auditRows('user.email_verified.asserted', later.userId)
      expect(laterRows).toHaveLength(1)
      expect(laterRows[0]).toMatchObject({
        before_value: { emailVerified: false },
        after_value: { emailVerified: true },
        metadata: { apiKeyId: admin.id, created: false },
      })
      await admin.api.dispose()
    }
  )

  test(
    'API-R-144 identify coerces a configured attribute and refuses an unknown or mistyped one',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const key = `seats_${marker.replace(/[^a-z0-9]/g, '_')}`
      await supportDb()`INSERT INTO user_attribute_definitions (id, key, label, type)
                        VALUES (${toUuid(generateId('user_attr'))}, ${key}, ${`Seats ${marker}`}, 'number')`
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
        roleKey: 'owner',
      })
      try {
        const email = `${marker}@customers.example`
        const user = await identify(admin.api, email, {
          externalId: `ext-${marker}`,
          attributes: { [key]: '12' },
        })
        expect(user.attributes).toEqual({ [key]: 12 })

        for (const attributes of [{ [`unknown_${key}`]: 1 }, { [key]: 'many' }]) {
          const bad = await expectJson(
            await admin.api.post('/api/v1/users/identify', { data: { email, attributes } }),
            400
          )
          expect(bad.error.code).toBe('VALIDATION_ERROR')
          expect(bad.error.message).toBe('One or more user attributes are invalid')
          expect(bad.error.details.invalidAttributes).toEqual([
            expect.objectContaining({ key: Object.keys(attributes)[0] }),
          ])
        }
        // Refused calls changed nothing.
        const [row] =
          await supportDb()`SELECT metadata FROM "user" WHERE id = ${toUuid(user.userId)}`
        expect(JSON.parse(row.metadata as string)[key]).toBe(12)
      } finally {
        await supportDb()`DELETE FROM user_attribute_definitions WHERE key = ${key}`
        await admin.api.dispose()
      }
    }
  )

  test(
    'API-R-144 API-R-146 metadata writes on an existing user: set, re-identify, remove by null',
    {
      tag: ['@nightly', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'Every metadata write on an existing user (PATCH attributes or externalId, identify with attributes) interpolates the removals array into sql as a parameter list, not an array: 500 "malformed array literal" (domains/users/user.identify.ts:81, :257)',
      },
    },
    async ({ playwright, baseURL, people, marker }) => {
      const key = `seats_${marker.replace(/[^a-z0-9]/g, '_')}`
      await supportDb()`INSERT INTO user_attribute_definitions (id, key, label, type)
                        VALUES (${toUuid(generateId('user_attr'))}, ${key}, ${`Seats ${marker}`}, 'number')`
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
        roleKey: 'owner',
      })
      try {
        const user = await identify(admin.api, `${marker}@customers.example`, {
          externalId: `ext-${marker}`,
          attributes: { [key]: 3 },
        })
        const set = await expectJson(
          await admin.api.patch(`/api/v1/users/${user.principalId}`, {
            data: { attributes: { [key]: 7 } },
          }),
          200
        )
        expect(set.data.attributes).toEqual({ [key]: 7 })
        const reIdentified = await identify(
          admin.api,
          `${marker}@customers.example`,
          { attributes: { [key]: '8' } },
          200
        )
        expect(reIdentified.attributes).toEqual({ [key]: 8 })
        const noAttr = await expectJson(
          await admin.api.patch(`/api/v1/users/${user.principalId}`, {
            data: { attributes: { [key]: null } },
          }),
          200
        )
        expect(noAttr.data.attributes).toEqual({})
        expect(noAttr.data.externalId).toBe(`ext-${marker}`)
        const noExt = await expectJson(
          await admin.api.patch(`/api/v1/users/${user.principalId}`, {
            data: { externalId: null },
          }),
          200
        )
        expect(noExt.data.externalId).toBeNull()
      } finally {
        await supportDb()`DELETE FROM user_attribute_definitions WHERE key = ${key}`
        await admin.api.dispose()
      }
    }
  )

  test(
    'API-R-146 a REST externalId lives in metadata, is not unique, and never fills the widget identity column',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
        roleKey: 'owner',
      })
      const externalId = `ext-${marker}`
      const a = await identify(admin.api, `${marker}-a@customers.example`, { externalId })
      const b = await identify(admin.api, `${marker}-b@customers.example`, { externalId })
      expect(a.externalId).toBe(externalId)
      expect(b.externalId).toBe(externalId)
      expect(a.principalId).not.toBe(b.principalId)
      const rows = await supportDb()`SELECT external_id FROM "user"
        WHERE id IN (${toUuid(a.userId)}, ${toUuid(b.userId)})`
      expect(rows.map((r) => r.external_id)).toEqual([null, null])
      await admin.api.dispose()
    }
  )

  test(
    'API-R-147 update a portal user; a teammate id is not found; a bad image is refused',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker, newTeammate }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
        roleKey: 'owner',
      })
      const user = await identify(admin.api, `${marker}@customers.example`, {
        image: 'https://images.example/a.png',
      })
      const body = await expectJson(
        await admin.api.patch(`/api/v1/users/${user.principalId}`, {
          data: { name: `Renamed ${marker}`, image: null, emailVerified: true },
        }),
        200
      )
      expect(Object.keys(body.data).sort()).toEqual(PROFILE_KEYS)
      expect(body.data).toMatchObject({
        principalId: user.principalId,
        name: `Renamed ${marker}`,
        image: null,
        emailVerified: true,
      })
      const [row] = await supportDb()`SELECT display_name, avatar_url FROM principal
                                      WHERE id = ${toUuid(user.principalId)}`
      expect(row).toEqual({ display_name: `Renamed ${marker}`, avatar_url: null })
      // Unlike identify, PATCH vouching for the email writes no audit row.
      expect(await auditRows('user.email_verified.asserted', user.userId)).toEqual([])

      const mate = await newTeammate({ roleKey: 'manager' })
      const teammate = await expectJson(
        await admin.api.patch(`/api/v1/users/${mate.principalId}`, { data: { name: 'x' } }),
        404
      )
      expect(teammate.error).toEqual({ code: 'NOT_FOUND', message: 'Member not found' })

      const badImage = await expectJson(
        await admin.api.patch(`/api/v1/users/${user.principalId}`, {
          data: { image: 'not a url' },
        }),
        400
      )
      expect(badImage.error.code).toBe('BAD_REQUEST')
      expect(badImage.error.message).toBe('Invalid request body')
      expect(Object.keys(badImage.error.details.errors)).toEqual(['image'])
      await admin.api.dispose()
    }
  )

  test(
    'API-R-148 delete a portal user: content moves to the placeholder, sessions end',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker, newTeammate }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
        roleKey: 'owner',
      })
      const email = `${marker}@customers.example`
      const user = await identify(admin.api, email)
      const board = await makeBoard(admin.api, marker)
      const postId = await makePost(admin.api, board, `Post ${marker}`, {
        authorPrincipalId: user.principalId,
      })
      await mintSession(user.userId)

      const res = await admin.api.delete(`/api/v1/users/${user.principalId}`)
      expect(res.status(), await res.text()).toBe(204)

      expect(await principalRole(user.principalId)).toBeNull()
      const [post] = await supportDb()`SELECT principal_id FROM posts
                                       WHERE id = ${toUuid(postId as `post_${string}`)}`
      expect(post.principal_id).toBe(toUuid(DELETED_USER as `principal_${string}`))
      const [sessions] = await supportDb()`SELECT count(*)::int AS n FROM session
                                           WHERE user_id = ${toUuid(user.userId)}`
      expect(sessions.n).toBe(0)
      const [kept] = await supportDb()`SELECT email FROM "user" WHERE id = ${toUuid(user.userId)}`
      expect(kept.email).toBe(email)

      const mate = await newTeammate({ roleKey: 'manager' })
      for (const id of [user.principalId, mate.principalId]) {
        const again = await expectJson(await admin.api.delete(`/api/v1/users/${id}`), 404)
        expect(again.error).toEqual({ code: 'NOT_FOUND', message: 'Member not found' })
      }
      expect(await principalRole(mate.principalId)).toBe('member')
      await admin.api.dispose()
    }
  )

  test(
    'API-R-148 deleting a portal user clears the visitor email on their conversations',
    {
      tag: ['@core', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'removePortalUser re-attributes conversations to the deleted-user placeholder before clearing visitor_email by the old principal id, so the email is never cleared (domains/users/user.service.ts:494-499)',
      },
    },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
        roleKey: 'owner',
      })
      const email = `${marker}@customers.example`
      const user = await identify(admin.api, email)
      const { conversationId } = await seedConv(marker)
      const convUuid = toUuid(conversationId as `conversation_${string}`)
      await supportDb()`UPDATE conversations SET visitor_principal_id = ${toUuid(user.principalId)},
                          visitor_email = ${email} WHERE id = ${convUuid}`
      const res = await admin.api.delete(`/api/v1/users/${user.principalId}`)
      expect(res.status(), await res.text()).toBe(204)
      const [conv] =
        await supportDb()`SELECT visitor_email FROM conversations WHERE id = ${convUuid}`
      expect(conv.visitor_email).toBeNull()
      await admin.api.dispose()
    }
  )

  test(
    'API-R-149 people routes refuse by scope, then by the creator permission',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker }) => {
      const adminEmail = people.people.admin.email
      const readOnly = await keyApi(playwright, baseURL, {
        creatorEmail: adminEmail,
        scopes: ['read:feedback'],
      })
      const writer = await keyApi(playwright, baseURL, { creatorEmail: adminEmail })
      const user = await identify(writer.api, `${marker}@customers.example`)

      const scopeMessage =
        "This API key is missing the 'write:feedback' scope required by 'people.manage'"
      await expectForbidden(
        await readOnly.api.post('/api/v1/users/identify', {
          data: { email: `${marker}-new@customers.example` },
        }),
        scopeMessage
      )
      await expectForbidden(
        await readOnly.api.patch(`/api/v1/users/${user.principalId}`, { data: { name: 'x' } }),
        scopeMessage
      )
      await expectForbidden(
        await readOnly.api.delete(`/api/v1/users/${user.principalId}`),
        scopeMessage
      )
      // The same key reads.
      await expectJson(await readOnly.api.get(`/api/v1/users/${user.principalId}`), 200)
      expect(await principalRole(user.principalId)).toBe('user')

      const chat = await keyApi(playwright, baseURL, {
        creatorEmail: adminEmail,
        scopes: ['read:chat'],
      })
      for (const [path, permission] of [
        ['/api/v1/users', 'people.view'],
        ['/api/v1/companies', 'company.view'],
        ['/api/v1/principals', 'member.view'],
      ]) {
        await expectForbidden(
          await chat.api.get(path),
          `This API key is missing the 'read:feedback' scope required by '${permission}'`
        )
        await expectJson(await writer.api.get(path), 200)
      }

      const name = `No people ${marker}`
      const mate = customTeammate(name, ['member.view'])
      const personal = await keyApi(playwright, baseURL, { creatorEmail: mate.email })
      await expectForbidden(
        await personal.api.get('/api/v1/users'),
        "Requires the 'people.view' permission"
      )
      await expectJson(await personal.api.get('/api/v1/principals'), 200)
      for (const k of [readOnly, writer, chat, personal]) await k.api.dispose()
    }
  )

  test(
    'API-R-150 the principal card answers sessions only, without email',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker, newTeammate }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
        roleKey: 'owner',
      })
      const customer = await identify(admin.api, `${marker}@customers.example`, { name: marker })
      const mate = await newTeammate({ roleKey: 'manager' })
      const teammateSession = await mate.api(playwright)
      const card = await teammateSession.get(`/api/v1/users/${customer.principalId}/card`)
      expect(card.status(), await card.text()).toBe(200)
      const body = await card.json()
      expect(Object.keys(body).sort()).toEqual(
        ['avatarUrl', 'displayName', 'joinedAt', 'principalId', 'role'].sort()
      )
      expect(body).toMatchObject({
        principalId: customer.principalId,
        displayName: marker,
        role: 'user',
      })

      // A signed-in portal user may read a teammate's card.
      const portal = await sessionApi(playwright, customer.userId)
      const teammateCard = await portal.get(`/api/v1/users/${mate.principalId}/card`)
      expect(teammateCard.status()).toBe(200)
      expect((await teammateCard.json()).role).toBe('member')

      // A key, or an anonymous visitor's session, is refused.
      const keyed = await apiFor(playwright, baseURL, admin.key)
      const viaKey = await keyed.get(`/api/v1/users/${customer.principalId}/card`)
      expect(viaKey.status()).toBe(403)
      expect(await viaKey.json()).toEqual({ error: 'Forbidden' })
      const anon = await mintCustomer({ anonymous: true })
      const anonymous = await sessionApi(playwright, anon.userId)
      const viaAnon = await anonymous.get(`/api/v1/users/${customer.principalId}/card`)
      expect(viaAnon.status()).toBe(403)
      expect(await viaAnon.json()).toEqual({ error: 'Forbidden' })

      const unknown = await teammateSession.get(`/api/v1/users/${generateId('principal')}/card`)
      expect(unknown.status()).toBe(404)
      expect(await unknown.json()).toEqual({ error: 'Not Found' })
      for (const c of [teammateSession, portal, keyed, anonymous, admin.api]) await c.dispose()
    }
  )

  test(
    'API-R-150 a malformed id on the principal card is a clean 4xx',
    {
      tag: ['@nightly', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'The raw id is queried against a typeid column outside any try: 500 (routes/api/v1/users/$principalId.card.ts:53)',
      },
    },
    async ({ playwright, newTeammate }) => {
      const mate = await newTeammate({ roleKey: 'manager' })
      const session = await mate.api(playwright)
      const res = await session.get('/api/v1/users/not-an-id/card')
      expect(res.status(), await res.text()).toBeGreaterThanOrEqual(400)
      expect(res.status()).toBeLessThan(500)
      await session.dispose()
    }
  )
})

test.describe('REST companies', () => {
  test(
    'API-R-151 list and get companies with member counts',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
        roleKey: 'owner',
      })
      const u1 = await identify(admin.api, `${marker}-1@customers.example`)
      const u2 = await identify(admin.api, `${marker}-2@customers.example`)
      const one = await seedCompany(marker, 'one', [u1.principalId, u2.principalId])
      const two = await seedCompany(marker, 'two')

      const list = await expectJson(await admin.api.get(`/api/v1/companies?search=${marker}`), 200)
      expect(ids(list, 'id').sort()).toEqual([one.id, two.id].sort())
      const first = list.data.find((c: Wire) => c.id === one.id)
      expect(Object.keys(first).sort()).toEqual(COMPANY_KEYS)
      expect(first).toMatchObject({ name: one.name, externalId: one.externalId, memberCount: 2 })

      const exact = await expectJson(
        await admin.api.get(`/api/v1/companies?company_id=${one.externalId}`),
        200
      )
      expect(ids(exact, 'id')).toEqual([one.id])

      const page1 = await expectJson(
        await admin.api.get(`/api/v1/companies?search=${marker}&limit=1`),
        200
      )
      expect(page1.data).toHaveLength(1)
      expect(page1.meta.pagination.hasMore).toBe(true)
      const page2 = await expectJson(
        await admin.api.get(
          `/api/v1/companies?search=${marker}&limit=1&cursor=${page1.meta.pagination.cursor}`
        ),
        200
      )
      expect([...ids(page1, 'id'), ...ids(page2, 'id')].sort()).toEqual([one.id, two.id].sort())
      // A malformed cursor is ignored: the first page again.
      const garbage = await expectJson(
        await admin.api.get(`/api/v1/companies?search=${marker}&limit=1&cursor=garbage`),
        200
      )
      expect(ids(garbage, 'id')).toEqual(ids(page1, 'id'))

      const got = await expectJson(await admin.api.get(`/api/v1/companies/${one.id}`), 200)
      expect(got.data).toMatchObject({ id: one.id, memberCount: 2 })
      const missingId = generateId('company')
      const missing = await expectJson(await admin.api.get(`/api/v1/companies/${missingId}`), 404)
      expect(missing.error.code).toBe('NOT_FOUND')
      expect(missing.error.message).toContain(missingId)
      const malformed = await expectJson(await admin.api.get('/api/v1/companies/bad'), 400)
      expect(malformed.error.message).toBe('Invalid company ID format')
      await admin.api.dispose()
    }
  )

  test(
    'API-R-152 a malformed tag or segment filter gives an empty page, never the full list',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
        roleKey: 'owner',
      })
      const company = await seedCompany(marker, 'only')
      const control = await expectJson(
        await admin.api.get(`/api/v1/companies?search=${marker}`),
        200
      )
      expect(ids(control, 'id')).toEqual([company.id])
      for (const filter of ['tag_id', 'segment_id']) {
        const body = await expectJson(
          await admin.api.get(`/api/v1/companies?search=${marker}&${filter}=garbage`),
          200
        )
        expect(body).toEqual({ data: [], meta: { pagination: { cursor: null, hasMore: false } } })
      }
      await admin.api.dispose()
    }
  )
})

test.describe('REST segment members', () => {
  test(
    'API-R-153 add members by slug: dedupe, only people, failures listed, manual rows kept',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker, newTeammate }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
        roleKey: 'owner',
      })
      const seg = await seedSegment(marker)
      const u1 = await identify(admin.api, `${marker}-1@customers.example`)
      const u2 = await identify(admin.api, `${marker}-2@customers.example`)
      const mate = await newTeammate({ roleKey: 'manager' })
      const anon = await mintCustomer({ anonymous: true })
      const unknown = generateId('principal')

      const body = await expectJson(
        await admin.api.post(`/api/v1/segments/${seg.slug}/members`, {
          data: {
            principalIds: [
              u1.principalId,
              u1.principalId,
              u2.principalId,
              mate.principalId,
              anon.principalId,
              admin.principalId,
              unknown,
            ],
          },
        }),
        200
      )
      expect(body.data).toEqual({
        added: 3,
        failed: [anon.principalId, admin.principalId, unknown],
      })
      const rows = await segmentRows(seg.uuid)
      expect(Object.fromEntries(rows)).toEqual({
        [toUuid(u1.principalId)]: 'api',
        [toUuid(u2.principalId)]: 'api',
        [toUuid(mate.principalId)]: 'api',
      })
      const audits = await auditRows('segment.member.added', seg.id)
      expect(audits.map((a) => a.metadata.principalId).sort()).toEqual(
        [u1.principalId, u2.principalId, mate.principalId].sort()
      )
      expect(audits[0]).toMatchObject({ actor_role: 'admin', metadata: { source: 'api' } })

      // A manual assignment is never demoted.
      const u3 = await identify(admin.api, `${marker}-3@customers.example`)
      await supportDb()`INSERT INTO user_segments (principal_id, segment_id, added_by)
                        VALUES (${toUuid(u3.principalId)}, ${seg.uuid}, 'manual')`
      const again = await expectJson(
        await admin.api.post(`/api/v1/segments/${seg.slug}/members`, {
          data: { principalIds: [u3.principalId] },
        }),
        200
      )
      // Already a member: nothing is added, and the manual row is kept.
      expect(again.data).toEqual({ added: 0, failed: [] })
      expect((await segmentRows(seg.uuid)).get(toUuid(u3.principalId))).toBe('manual')
      await admin.api.dispose()
    }
  )

  test(
    'API-R-154 remove members: the row goes, an unknown id is listed',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
        roleKey: 'owner',
      })
      const seg = await seedSegment(marker)
      const member = await identify(admin.api, `${marker}@customers.example`)
      await supportDb()`INSERT INTO user_segments (principal_id, segment_id, added_by)
                        VALUES (${toUuid(member.principalId)}, ${seg.uuid}, 'sso')`
      const unknown = generateId('principal')
      const body = await expectJson(
        await admin.api.delete(`/api/v1/segments/${seg.slug}/members`, {
          data: { principalIds: [member.principalId, unknown] },
        }),
        200
      )
      expect(body.data).toEqual({ removed: 1, failed: [unknown] })
      expect((await segmentRows(seg.uuid)).size).toBe(0)
      const audits = await auditRows('segment.member.removed', seg.id)
      expect(audits.map((a) => a.metadata.principalId)).toEqual([member.principalId])
      await admin.api.dispose()
    }
  )

  test(
    'API-R-155 segment members: unknown slug and bad lists are refused',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
        roleKey: 'owner',
      })
      const seg = await seedSegment(marker)
      const user = await identify(admin.api, `${marker}@customers.example`)
      const missing = await expectJson(
        await admin.api.post(`/api/v1/segments/${seg.slug}-missing/members`, {
          data: { principalIds: [user.principalId] },
        }),
        404
      )
      expect(missing.error).toEqual({ code: 'NOT_FOUND', message: 'Segment not found' })
      for (const principalIds of [[], Array.from({ length: 1001 }, () => user.principalId)]) {
        const bad = await expectJson(
          await admin.api.post(`/api/v1/segments/${seg.slug}/members`, {
            data: { principalIds },
          }),
          400
        )
        expect(bad.error.code).toBe('BAD_REQUEST')
      }
      expect((await segmentRows(seg.uuid)).size).toBe(0)
      // The same slug takes a good list.
      const ok = await expectJson(
        await admin.api.post(`/api/v1/segments/${seg.slug}/members`, {
          data: { principalIds: [user.principalId] },
        }),
        200
      )
      expect(ok.data).toEqual({ added: 1, failed: [] })
      await admin.api.dispose()
    }
  )

  test(
    'API-R-155 a malformed id is listed in failed and a non-JSON body is a 400',
    {
      tag: ['@nightly', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'A malformed principal id reaches inArray on a typeid column and a non-JSON body throws outside zod: both 500 (routes/api/v1/segments/$slug.members.ts:38-41, :71)',
      },
    },
    async ({ playwright, baseURL, people, marker }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
        roleKey: 'owner',
      })
      const seg = await seedSegment(marker)
      const user = await identify(admin.api, `${marker}@customers.example`)
      const body = await expectJson(
        await admin.api.post(`/api/v1/segments/${seg.slug}/members`, {
          data: { principalIds: ['not-an-id', user.principalId] },
        }),
        200
      )
      expect(body.data).toEqual({ added: 1, failed: ['not-an-id'] })
      const notJson = await expectJson(
        await admin.api.post(`/api/v1/segments/${seg.slug}/members`, {
          headers: { 'content-type': 'application/json' },
          data: 'not json',
        }),
        400
      )
      expect(notJson.error.code).toBe('BAD_REQUEST')
      await admin.api.dispose()
    }
  )
})

test.describe('REST teammates', () => {
  test(
    'API-R-157 /principals and /members list the same teammates; a portal user is not one',
    { tag: '@nightly' },
    async ({ playwright, baseURL, people, marker, newTeammate }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
        roleKey: 'owner',
      })
      const mate = await newTeammate({ roleKey: 'manager' })
      const user = await identify(admin.api, `${marker}@customers.example`)
      const principals = await expectJson(await admin.api.get('/api/v1/principals'), 200)
      const members = await expectJson(await admin.api.get('/api/v1/members'), 200)
      expect(ids(members, 'id').sort()).toEqual(ids(principals, 'id').sort())
      const listed = principals.data.find((m: Wire) => m.id === mate.principalId)
      expect(Object.keys(listed).sort()).toEqual(MEMBER_KEYS)
      expect(listed).toMatchObject({ email: mate.email, role: 'member' })
      expect(ids(principals, 'id')).toContain(people.people.admin.principalId)
      expect(ids(principals, 'id')).not.toContain(user.principalId)
      expect(principals.data.every((m: Wire) => ['admin', 'member'].includes(m.role))).toBe(true)

      const one = await expectJson(
        await admin.api.get(`/api/v1/principals/${mate.principalId}`),
        200
      )
      expect(one.data).toEqual(listed)
      const portal = await expectJson(
        await admin.api.get(`/api/v1/principals/${user.principalId}`),
        404
      )
      expect(portal.error).toEqual({ code: 'NOT_FOUND', message: 'Member not found' })
      await admin.api.dispose()
    }
  )

  test(
    'API-R-158 change a teammate role: admin key promotes and is audited; ceilings refuse',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker, newTeammate }) => {
      test.setTimeout(90_000)
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
        roleKey: 'owner',
      })
      const mate = await newTeammate({ roleKey: 'manager' })
      const promoted = await expectJson(
        await admin.api.patch(`/api/v1/principals/${mate.principalId}`, {
          data: { role: 'admin' },
        }),
        200
      )
      expect(promoted.data).toMatchObject({ id: mate.principalId, role: 'admin' })
      const [audit] = await auditRows('user.role.changed', mate.principalId)
      expect(audit).toMatchObject({
        actor_type: 'api_key',
        auth_method: 'api_key',
        before_value: { role: 'member' },
        after_value: { role: 'admin' },
      })

      // A member-role key holding member.manage.
      const roleName = `Member manager ${marker}`
      customTeammate(roleName, ['member.view', 'member.manage'])
      const managerKey = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
        roleKey: customRoleKey(roleName),
      })
      const target = await newTeammate({ roleKey: 'manager' })
      await expectForbidden(
        await managerKey.api.patch(`/api/v1/principals/${target.principalId}`, {
          data: { role: 'admin' },
        }),
        'Only an admin can grant the Admin role'
      )
      const above = await expectJson(
        await managerKey.api.patch(`/api/v1/principals/${target.principalId}`, {
          data: { role: 'member', roleId: await roleIdOf('contributor') },
        }),
        403
      )
      expect(above.error.message).toMatch(
        /^You can't grant a role with permissions you don't hold: /
      )
      // Within its ceiling the same key assigns a role.
      const smallName = `Viewer ${marker}`
      customTeammate(smallName, ['member.view'])
      const within = await expectJson(
        await managerKey.api.patch(`/api/v1/principals/${target.principalId}`, {
          data: { role: 'member', roleId: await roleIdOf(customRoleKey(smallName)) },
        }),
        200
      )
      expect(within.data.role).toBe('member')

      const mixed = await expectJson(
        await admin.api.patch(`/api/v1/principals/${target.principalId}`, {
          data: { role: 'admin', roleId: await roleIdOf('contributor') },
        }),
        400
      )
      expect(mixed.error.message).toBe(
        'Custom role grants ride the member role; use role admin without a roleId to promote'
      )

      // A portal user who has signed in joins the team; one who has not is refused.
      const signedIn = await identify(admin.api, `${marker}-in@customers.example`)
      await mintSession(signedIn.userId)
      try {
        const joined = await expectJson(
          await admin.api.patch(`/api/v1/principals/${signedIn.principalId}`, {
            data: { role: 'member' },
          }),
          200
        )
        expect(joined.data).toMatchObject({ id: signedIn.principalId, role: 'member' })
      } finally {
        await supportDb()`UPDATE principal SET role = 'user'
                          WHERE id = ${toUuid(signedIn.principalId)}`
      }
      const never = await identify(admin.api, `${marker}-out@customers.example`, {
        name: `Never ${marker}`,
      })
      const refused = await expectJson(
        await admin.api.patch(`/api/v1/principals/${never.principalId}`, {
          data: { role: 'member' },
        }),
        400
      )
      expect(refused.error.message).toBe(
        `Never ${marker} hasn't signed in yet. Invite them by email instead.`
      )
      expect(await principalRole(never.principalId)).toBe('user')
      await admin.api.dispose()
      await managerKey.api.dispose()
    }
  )

  test(
    'API-R-160 remove a teammate: audited, personal keys die; an admin needs an admin remover',
    { tag: '@core' },
    async ({ playwright, baseURL, people, marker, newTeammate }) => {
      const admin = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
        roleKey: 'owner',
      })
      const mate = await newTeammate({ roleKey: 'manager' })
      const personal = createKey({ creatorEmail: mate.email })
      const mateApi = await apiFor(playwright, baseURL, personal.key)
      await expectJson(await mateApi.get('/api/v1/principals'), 200)

      const res = await admin.api.delete(`/api/v1/principals/${mate.principalId}`)
      expect(res.status(), await res.text()).toBe(204)
      expect(await principalRole(mate.principalId)).toBe('user')
      const [audit] = await auditRows('user.removed', mate.principalId)
      expect(audit).toMatchObject({
        actor_type: 'api_key',
        before_value: { role: 'member' },
        after_value: { role: 'user' },
      })
      const dead = await expectJson(await mateApi.get('/api/v1/principals'), 401)
      expect(dead.error.message).toBe(UNAUTHORIZED_MESSAGE)
      const again = await expectJson(
        await admin.api.delete(`/api/v1/principals/${mate.principalId}`),
        404
      )
      expect(again.error).toEqual({ code: 'NOT_FOUND', message: 'Member not found' })

      // A member-role key with member.manage removes a member but not an admin.
      const roleName = `Remover ${marker}`
      customTeammate(roleName, ['member.view', 'member.manage'])
      const remover = await keyApi(playwright, baseURL, {
        creatorEmail: people.people.admin.email,
        kind: 'workspace',
        roleKey: customRoleKey(roleName),
      })
      const otherAdmin = await newTeammate({ roleKey: 'admin' })
      await expectForbidden(
        await remover.api.delete(`/api/v1/principals/${otherAdmin.principalId}`),
        'Only an admin can change or remove an admin'
      )
      expect(await principalRole(otherAdmin.principalId)).toBe('admin')
      const member = await newTeammate({ roleKey: 'manager' })
      expect((await remover.api.delete(`/api/v1/principals/${member.principalId}`)).status()).toBe(
        204
      )
      for (const c of [admin.api, mateApi, remover.api]) await c.dispose()
    }
  )
})
