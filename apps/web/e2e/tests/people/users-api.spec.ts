/**
 * People over the REST API (/api/v1/users), the people server functions'
 * refusals and permission gates.
 *
 * Journeys: PPL-U-45, PPL-U-57, PPL-U-59, PPL-U-64
 */
import { generateId } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { expectJson } from '../../support/api-client'
import {
  DELETED_USER_PRINCIPAL,
  mustCall,
  personApi,
  portalUserRow,
  refusedCall,
  restAdmin,
  seedLead,
} from '../../product/people'

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
      tag: ['@core', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'GET /api/v1/users/:id passes a full sentence to notFoundResponse, which appends "not found" again; see QUARANTINE.md',
      },
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
})
