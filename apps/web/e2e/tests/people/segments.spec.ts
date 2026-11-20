/**
 * Segments in the admin: create, rules and evaluation, manual membership,
 * the segment filter on the people list, delete, REST membership and the
 * permission gates on segment writes.
 *
 * Journeys: PPL-G-01, PPL-G-03, PPL-G-05, PPL-G-06, PPL-G-07, PPL-G-08,
 * PPL-G-17, PPL-G-20, PPL-G-21, PPL-G-22, PPL-G-25, PPL-G-27, PPL-G-28,
 * PPL-G-30, PPL-G-44; nightly PPL-G-02, PPL-G-09, PPL-G-11, PPL-G-12, PPL-G-13,
 * PPL-G-15, PPL-G-19, PPL-G-23, PPL-G-31, PPL-G-45
 */
import type { Locator, Page } from '@playwright/test'
import { waitForHydration } from '../../utils/helpers'
import { randomUUID } from 'node:crypto'
import { generateId, toUuid } from '@quackback/ids'
import { test, expect } from '../../support/fixtures'
import { supportDb } from '../../support/db'
import { apiFor, expectJson } from '../../support/api-client'
import { supportEnv } from '../../support/env'
import { runSweep } from '../../support/sweeps'
import { createRole } from '../../support/access'
import {
  callServerFn,
  createSegment,
  evaluate,
  linkCompany,
  memberIds,
  membersOf,
  mustCall,
  personApi,
  portalUser,
  portalUserRow,
  refusedCall,
  restAdmin,
  restAs,
  seedAnonymous,
  seedBoard,
  seedCompany,
  seedPost,
  segmentAudit,
  segmentRow,
  setUserMetadata,
  usersUrl,
  type SegmentCondition,
} from '../../product/people-segments'

/** The segment's row in the Users page nav (the hover actions live on it). */
function navRow(page: Page, name: string) {
  return page
    .locator('div.group')
    .filter({ has: page.getByRole('button', { name: new RegExp(`^${name}`) }) })
}

/** Click a server-rendered control once React has hydrated it. */
async function hydratedClick(target: Locator): Promise<void> {
  await waitForHydration(target)
  await target.click()
}

/** The Segments rail card on a person's profile. */
function segmentsCard(page: Page) {
  return page
    .locator('div.rounded-lg')
    .filter({ has: page.getByRole('heading', { name: 'Segments', exact: true }) })
}

/** Dynamic segment limited to this test's people, evaluated; returns its members. */
async function evaluatedMembers(
  admin: Parameters<typeof createSegment>[0],
  marker: string,
  label: string,
  rule: SegmentCondition
): Promise<string[]> {
  const seg = await createSegment(admin, {
    name: `${label} ${marker}`,
    type: 'dynamic',
    match: 'all',
    conditions: [{ attribute: 'email', operator: 'contains', value: marker }, rule],
  })
  await evaluate(admin, seg.id)
  return memberIds(seg.id)
}

test.describe('segment create', () => {
  test(
    'PPL-G-01 create a manual segment from the Users page',
    { tag: '@core' },
    async ({ asPerson, marker }) => {
      const admin = await asPerson('admin')
      await admin.goto('/admin/users')
      await hydratedClick(admin.getByRole('button', { name: 'New segment' }))
      const dialog = admin.getByRole('dialog')
      await expect(dialog.getByRole('heading', { name: 'Create segment' })).toBeVisible()
      const create = dialog.getByRole('button', { name: 'Create segment' })
      await expect(create).toBeDisabled()

      const name = `Enterprise ${marker}`
      await dialog.getByLabel('Name').fill(name)
      await expect(create).toBeEnabled()
      await create.click()
      await expect(dialog).toBeHidden()

      const row = admin.getByRole('button', { name: new RegExp(`^${name}`) })
      await expect(row).toBeVisible()
      await expect(row).toContainText('0')

      const [seg] = await supportDb()`SELECT type, rules, evaluation_schedule, slug, color
        FROM segments WHERE name = ${name} AND deleted_at IS NULL`
      expect(seg).toMatchObject({
        type: 'manual',
        rules: null,
        evaluation_schedule: null,
        slug: `enterprise-${marker}`,
      })
      expect(seg.color).toMatch(/^#[0-9a-f]{6}$/i)
    }
  )

  test(
    'PPL-G-03 a dynamic segment needs at least one rule, and a name',
    { tag: '@core' },
    async ({ asPerson, playwright, marker }) => {
      const page = await asPerson('admin')
      await page.goto('/admin/users')
      await hydratedClick(page.getByRole('button', { name: 'New segment' }))
      const dialog = page.getByRole('dialog')
      await dialog.getByRole('button', { name: /Auto-populate based on rules/ }).click()
      await dialog.getByLabel('Name').fill(`Dyn ${marker}`)
      await expect(dialog.getByRole('button', { name: 'Create segment' })).toBeDisabled()
      await dialog.getByRole('button', { name: 'Add condition' }).click()
      await expect(dialog.getByRole('button', { name: 'Create segment' })).toBeEnabled()
      await page.keyboard.press('Escape')

      const admin = await personApi(playwright, 'admin')
      const noRules = await refusedCall(admin, 'createSegmentFn', {
        name: `Dyn ${marker}`,
        type: 'dynamic',
      })
      expect(noRules.code).toBe('VALIDATION_ERROR')
      expect(noRules.error).toContain('Dynamic segments require at least one rule condition')
      const blank = await refusedCall(admin, 'createSegmentFn', { name: '   ', type: 'manual' })
      expect(blank.code).toBe('VALIDATION_ERROR')
      expect(blank.error).toContain('Segment name is required')
      const rows = await supportDb()`SELECT id FROM segments WHERE name = ${`Dyn ${marker}`}`
      expect(rows).toHaveLength(0)
      await admin.dispose()
    }
  )
})

test.describe('dynamic evaluation', () => {
  test(
    'PPL-G-05 evaluation only ever matches identified portal users',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      const admin = await personApi(playwright, 'admin')
      const person = await portalUserRow(marker)
      await seedAnonymous(marker)
      const mate = await newTeammate({ roleKey: 'contributor', name: `Mate ${marker}` })
      // A teammate's test customer (one per teammate).
      const testCustomer = await portalUserRow(marker)
      await supportDb()`UPDATE principal
        SET test_owner_principal_id = ${toUuid(mate.principalId as `principal_${string}`)}
        WHERE id = ${testCustomer.principalUuid}`

      const seg = await createSegment(admin, {
        name: `Named ${marker}`,
        type: 'dynamic',
        conditions: [{ attribute: 'name', operator: 'contains', value: marker }],
      })
      const result = await evaluate(admin, seg.id)
      expect(result).toMatchObject({ segmentId: seg.id, added: 1, removed: 0 })
      expect(await membersOf(seg.id)).toEqual([
        { principalId: person.principalId, addedBy: 'dynamic' },
      ])
      await admin.dispose()
    }
  )

  test(
    'PPL-G-06 rules on built-in person fields',
    { tag: '@core' },
    async ({ playwright, marker }) => {
      // Seven segments evaluated in turn.
      test.slow()
      const admin = await personApi(playwright, 'admin')
      const sql = supportDb()
      const domain = `acme-${marker.slice(-8)}.test`
      // A: upper-case address, country US, one live post, no account row.
      const a = await portalUserRow(marker, { email: `${marker}-a@${domain.toUpperCase()}` })
      // B: unverified, locale fr, only a deleted post, signed up with GitHub.
      const b = await portalUserRow(marker, { verified: false })
      // C: joined 40 days ago, nothing else.
      const c = await portalUserRow(marker)
      await sql`UPDATE "user" SET country = 'US' WHERE id = ${a.userUuid}`
      await sql`UPDATE "user" SET locale = 'fr' WHERE id = ${b.userUuid}`
      await sql`UPDATE principal SET created_at = NOW() - INTERVAL '40 days' WHERE id = ${c.principalUuid}`
      await sql`INSERT INTO account (id, account_id, provider_id, user_id, created_at, updated_at)
                VALUES (${randomUUID()}, ${`gh-${marker}`}, 'github', ${b.userUuid}, NOW(), NOW())`
      const board = await seedBoard(marker)
      await seedPost(board.id, a.principalUuid, `Live ${marker}`)
      const gone = await seedPost(board.id, b.principalUuid, `Deleted ${marker}`)
      await sql`UPDATE posts SET deleted_at = NOW() WHERE id = ${toUuid(gone.id as `post_${string}`)}`

      const sorted = (...ids: string[]) => [...ids].sort()
      expect(
        await evaluatedMembers(admin, marker, 'Domain', {
          attribute: 'email',
          operator: 'ends_with',
          value: `@${domain}`,
        }),
        'email compares lower-cased'
      ).toEqual([a.principalId])
      expect(
        await evaluatedMembers(admin, marker, 'Unverified', {
          attribute: 'email_verified',
          operator: 'eq',
          value: false,
        })
      ).toEqual([b.principalId])
      expect(
        await evaluatedMembers(admin, marker, 'Country', {
          attribute: 'country',
          operator: 'eq',
          value: 'us',
        }),
        'country upper-cases the value'
      ).toEqual([a.principalId])
      expect(
        await evaluatedMembers(admin, marker, 'Locale', {
          attribute: 'locale',
          operator: 'neq',
          value: 'fr',
        }),
        'neq includes people with no locale'
      ).toEqual(sorted(a.principalId, c.principalId))
      expect(
        await evaluatedMembers(admin, marker, 'Posters', {
          attribute: 'post_count',
          operator: 'gte',
          value: 1,
        }),
        'deleted posts do not count'
      ).toEqual([a.principalId])
      expect(
        await evaluatedMembers(admin, marker, 'Source', {
          attribute: 'signup_source',
          operator: 'eq',
          value: 'email',
        }),
        'no account row means email'
      ).toEqual(sorted(a.principalId, c.principalId))
      expect(
        await evaluatedMembers(admin, marker, 'Old', {
          attribute: 'created_at_days_ago',
          operator: 'gt',
          value: 30,
        })
      ).toEqual([c.principalId])
      await admin.dispose()
    }
  )

  test(
    'PPL-G-06 vote and comment count rules match people who voted and commented',
    {
      tag: ['@core', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'activityCountSql counts rows in tables named "votes" and "comments", which do not exist (post_votes, post_comments), so any vote_count or comment_count rule fails evaluation with a server error (segment.evaluation.ts); see QUARANTINE.md',
      },
    },
    async ({ browser, playwright, marker }) => {
      const admin = await personApi(playwright, 'admin')
      const active = await portalUser(browser, marker)
      await portalUserRow(marker) // no votes, no comments
      const board = await seedBoard(marker)
      const post = await seedPost(board.id, active.principalUuid, `Idea ${marker}`)
      await mustCall(active.api, 'toggleVoteFn', { postId: post.id })
      await mustCall(active.api, 'createCommentFn', { postId: post.id, content: `Hi ${marker}` })

      for (const attribute of ['vote_count', 'comment_count']) {
        const seg = await createSegment(admin, {
          name: `${attribute} ${marker}`,
          type: 'dynamic',
          conditions: [
            { attribute: 'email', operator: 'contains', value: marker },
            { attribute, operator: 'gte', value: 1 },
          ],
        })
        const res = await callServerFn(admin, 'evaluateSegmentFn', { segmentId: seg.id })
        expect(res.ok, `${attribute} rule evaluates: ${res.raw.slice(0, 200)}`).toBe(true)
        expect(await memberIds(seg.id), attribute).toEqual([active.principalId])
      }
      await admin.dispose()
    }
  )

  test(
    'PPL-G-07 rules on a user custom attribute',
    { tag: '@core' },
    async ({ playwright, marker }) => {
      const admin = await personApi(playwright, 'admin')
      const a = await portalUserRow(marker)
      const b = await portalUserRow(marker)
      const c = await portalUserRow(marker)
      await setUserMetadata(a.userUuid, { plan_tier: 'pro', seats: 12 })
      await setUserMetadata(b.userUuid, { plan_tier: 'free', seats: 3 })

      expect(
        await evaluatedMembers(admin, marker, 'Pro', {
          attribute: 'metadata_key',
          metadataKey: 'plan_tier',
          operator: 'eq',
          value: 'pro',
        })
      ).toEqual([a.principalId])
      expect(
        await evaluatedMembers(admin, marker, 'Seats', {
          attribute: 'metadata_key',
          metadataKey: 'seats',
          operator: 'gte',
          value: 10,
        }),
        'numbers compare as numbers (12 >= 10, 3 < 10)'
      ).toEqual([a.principalId])
      expect(
        await evaluatedMembers(admin, marker, 'NoSeats', {
          attribute: 'metadata_key',
          metadataKey: 'seats',
          operator: 'is_not_set',
        })
      ).toEqual([c.principalId])
      await admin.dispose()
    }
  )

  test('PPL-G-08 rules on company fields', { tag: '@core' }, async ({ playwright, marker }) => {
    const admin = await personApi(playwright, 'admin')
    const a = await portalUserRow(marker)
    const b = await portalUserRow(marker)
    const c = await portalUserRow(marker)
    const big = await seedCompany(marker, {
      plan: 'enterprise',
      mrrCents: 500_000,
      industry: 'saas',
      attrs: { tier: 'gold' },
    })
    const small = await seedCompany(marker, { plan: 'starter', mrrCents: 1_000 })
    await linkCompany(a.principalUuid, big)
    await linkCompany(b.principalUuid, small)
    const sorted = (...ids: string[]) => [...ids].sort()

    expect(
      await evaluatedMembers(admin, marker, 'Ent', {
        attribute: 'company_plan',
        operator: 'eq',
        value: 'enterprise',
      })
    ).toEqual([a.principalId])
    expect(
      await evaluatedMembers(admin, marker, 'NotEnt', {
        attribute: 'company_plan',
        operator: 'neq',
        value: 'enterprise',
      }),
      'neq includes people with no company'
    ).toEqual(sorted(b.principalId, c.principalId))
    expect(
      await evaluatedMembers(admin, marker, 'Spend', {
        attribute: 'company_mrr',
        operator: 'gte',
        value: 1000,
      }),
      'spend compares whole units (5000 >= 1000, 10 < 1000)'
    ).toEqual([a.principalId])
    expect(
      await evaluatedMembers(admin, marker, 'Industry', {
        attribute: 'company_industry',
        operator: 'is_set',
      })
    ).toEqual([a.principalId])
    expect(
      await evaluatedMembers(admin, marker, 'Gold', {
        attribute: 'company_attr',
        metadataKey: 'tier',
        operator: 'eq',
        value: 'gold',
      })
    ).toEqual([a.principalId])
    await admin.dispose()
  })

  test(
    'PPL-G-22 manual add or remove is refused on a dynamic segment',
    { tag: '@core' },
    async ({ playwright, marker }) => {
      const admin = await personApi(playwright, 'admin')
      const inside = await portalUserRow(marker)
      const outside = await portalUserRow(`x-${marker}`)
      const seg = await createSegment(admin, {
        name: `Dyn ${marker}`,
        type: 'dynamic',
        conditions: [{ attribute: 'email', operator: 'starts_with', value: `${marker}-` }],
      })
      await evaluate(admin, seg.id)
      expect(await memberIds(seg.id)).toEqual([inside.principalId])

      const add = await refusedCall(admin, 'assignUsersToSegmentFn', {
        segmentId: seg.id,
        principalIds: [outside.principalId],
      })
      expect(add.code).toBe('SEGMENT_TYPE_ERROR')
      expect(add.error).toContain('Cannot manually assign users to a dynamic segment')
      const remove = await refusedCall(admin, 'removeUsersFromSegmentFn', {
        segmentId: seg.id,
        principalIds: [inside.principalId],
      })
      expect(remove.code).toBe('SEGMENT_TYPE_ERROR')
      expect(remove.error).toContain('Cannot manually remove users from a dynamic segment')
      expect(await memberIds(seg.id)).toEqual([inside.principalId])
      await admin.dispose()
    }
  )
})

test.describe('manual membership in the admin', () => {
  test(
    'PPL-G-20 add a person to a manual segment from their profile',
    { tag: '@core' },
    async ({ asPerson, playwright, people, marker }) => {
      const api = await personApi(playwright, 'admin')
      const seg = await createSegment(api, { name: `Beta ${marker}`, type: 'manual' })
      const person = await portalUserRow(marker)

      const admin = await asPerson('admin')
      await admin.goto(usersUrl({ selected: person.principalId }))
      await expect(admin.getByRole('heading', { name: person.name, exact: true })).toBeVisible({
        timeout: 15_000,
      })
      const card = segmentsCard(admin)
      await hydratedClick(card.getByRole('button', { name: 'Add', exact: true }))
      await admin.getByRole('option', { name: seg.name }).click()
      await expect(admin.getByText(`Added to ${seg.name}`)).toBeVisible()
      await expect(card.locator(`span[title="${seg.name}"]`)).toBeVisible()

      expect(await membersOf(seg.id)).toEqual([
        { principalId: person.principalId, addedBy: 'manual' },
      ])
      const audit = await segmentAudit(seg.id, 'segment.member.added')
      expect(audit).toHaveLength(1)
      expect(audit[0].actor_email).toBe(people.people.admin.email)
      expect(audit[0].metadata).toMatchObject({ principalId: person.principalId, source: 'manual' })
      await api.dispose()
    }
  )

  test(
    'PPL-G-21 remove a person from a manual segment, then Undo',
    { tag: '@core' },
    async ({ asPerson, playwright, marker }) => {
      const api = await personApi(playwright, 'admin')
      const seg = await createSegment(api, { name: `Pilot ${marker}`, type: 'manual' })
      const person = await portalUserRow(marker)
      await mustCall(api, 'assignUsersToSegmentFn', {
        segmentId: seg.id,
        principalIds: [person.principalId],
      })
      const dyn = await createSegment(api, {
        name: `Auto ${marker}`,
        type: 'dynamic',
        conditions: [{ attribute: 'email', operator: 'eq', value: person.email }],
      })
      await evaluate(api, dyn.id)

      const admin = await asPerson('admin')
      await admin.goto(usersUrl({ selected: person.principalId }))
      const dynChip = admin.locator('span[title="Auto-managed segment"]', { hasText: dyn.name })
      await expect(dynChip).toBeVisible({ timeout: 15_000 })
      await expect(dynChip.getByRole('button')).toHaveCount(0)

      const chip = admin.locator(`span[title="${seg.name}"]`)
      const remove = chip.getByRole('button', { name: `Remove from ${seg.name}` })
      await waitForHydration(remove)
      await chip.hover()
      await remove.click()
      const toast = admin.locator('[data-sonner-toast]', { hasText: `Removed from ${seg.name}` })
      await expect(toast).toBeVisible()
      await expect(chip).toHaveCount(0)
      expect(await membersOf(seg.id)).toEqual([])
      const removed = await segmentAudit(seg.id, 'segment.member.removed')
      expect(removed).toHaveLength(1)
      expect(removed[0].metadata).toMatchObject({
        principalId: person.principalId,
        source: 'manual-bulk',
      })

      await toast.getByRole('button', { name: 'Undo' }).click()
      await expect(chip).toBeVisible()
      await expect
        .poll(() => membersOf(seg.id))
        .toEqual([{ principalId: person.principalId, addedBy: 'manual' }])
      expect(await segmentAudit(seg.id, 'segment.member.added')).toHaveLength(2)
      await api.dispose()
    }
  )

  test(
    'PPL-G-25 filter the users list by one or more segments',
    { tag: '@core' },
    async ({ asPerson, playwright, marker }) => {
      const api = await personApi(playwright, 'admin')
      const segA = await createSegment(api, { name: `Alpha ${marker}`, type: 'manual' })
      const segB = await createSegment(api, { name: `Bravo ${marker}`, type: 'manual' })
      const a = await portalUserRow(marker)
      const b = await portalUserRow(marker)
      const neither = await portalUserRow(marker)
      const lead = await seedAnonymous(marker)
      await mustCall(api, 'assignUsersToSegmentFn', {
        segmentId: segA.id,
        principalIds: [a.principalId, lead.principalId],
      })
      await mustCall(api, 'assignUsersToSegmentFn', {
        segmentId: segB.id,
        principalIds: [b.principalId],
      })

      const admin = await asPerson('admin')
      await admin.goto(usersUrl({ search: marker }))
      const row = (name: string) => admin.getByRole('heading', { level: 3, name, exact: true })
      await expect(row(neither.name)).toBeVisible({ timeout: 15_000 })

      await hydratedClick(admin.getByRole('button', { name: new RegExp(`^${segA.name}`) }))
      await expect(admin).toHaveURL(new RegExp(`segments=${segA.id}`))
      await expect(row(a.name)).toBeVisible()
      await expect(row(b.name)).toHaveCount(0)
      await expect(row(neither.name)).toHaveCount(0)
      await expect(row(lead.name), 'leads never appear').toHaveCount(0)

      await admin
        .getByRole('button', { name: new RegExp(`^${segB.name}`) })
        .click({ modifiers: ['Shift'] })
      await expect(admin).toHaveURL(new RegExp(`segments=${segA.id}(%2C|,)${segB.id}`))
      await expect(row(a.name)).toBeVisible()
      await expect(row(b.name)).toBeVisible()
      await expect(row(neither.name)).toHaveCount(0)

      await admin.getByRole('button', { name: /^All users/ }).click()
      await expect(admin).not.toHaveURL(/segments=/)
      await expect(row(neither.name)).toBeVisible()
      await api.dispose()
    }
  )

  test(
    'PPL-G-17 delete a segment removes it, its memberships and the active filter',
    { tag: '@core' },
    async ({ asPerson, playwright, marker }) => {
      const api = await personApi(playwright, 'admin')
      const seg = await createSegment(api, { name: `Doomed ${marker}`, type: 'manual' })
      const person = await portalUserRow(marker)
      await mustCall(api, 'assignUsersToSegmentFn', {
        segmentId: seg.id,
        principalIds: [person.principalId],
      })

      const admin = await asPerson('admin')
      await admin.goto(usersUrl({ segments: [seg.id] }))
      const nav = navRow(admin, seg.name)
      await expect(nav).toBeVisible({ timeout: 15_000 })
      await waitForHydration(nav.getByRole('button', { name: new RegExp(`^${seg.name}`) }))
      await nav.hover()
      await nav.getByTitle('Delete segment').click()
      const dialog = admin.getByRole('alertdialog')
      await expect(dialog.getByText(`Delete "${seg.name}"?`)).toBeVisible()
      await expect(dialog).toContainText(
        'This will permanently delete the segment and remove all user memberships. This cannot be undone.'
      )
      await dialog.getByRole('button', { name: 'Delete', exact: true }).click()

      await expect(nav).toHaveCount(0)
      await expect(admin).not.toHaveURL(new RegExp(seg.id))
      const row = await segmentRow(seg.id)
      expect(row.deleted_at).not.toBeNull()
      expect(await membersOf(seg.id)).toEqual([])
      await api.dispose()
    }
  )
})

test.describe('REST segment members', () => {
  test(
    'PPL-G-27 REST adds people by slug: duplicates collapse, only portal users join',
    { tag: '@core' },
    async ({ playwright, marker }) => {
      const api = await personApi(playwright, 'admin')
      const rest = await restAdmin(playwright)
      const seg = await createSegment(api, { name: `Api ${marker}`, type: 'manual' })
      const a = await portalUserRow(marker)
      const b = await portalUserRow(marker)
      const anon = await seedAnonymous(marker)
      const unknown = generateId('principal')
      // b is already a manual member; a REST add must not demote them.
      await mustCall(api, 'assignUsersToSegmentFn', {
        segmentId: seg.id,
        principalIds: [b.principalId],
      })

      const body = await expectJson(
        await rest.post(`/api/v1/segments/${seg.slug}/members`, {
          data: {
            principalIds: [a.principalId, a.principalId, b.principalId, anon.principalId, unknown],
          },
        }),
        200
      )
      // Only a was not a member yet; b already was.
      expect(body.data.added).toBe(1)
      expect([...body.data.failed].sort()).toEqual([anon.principalId, unknown].sort())
      const rows = await membersOf(seg.id)
      expect(rows).toEqual(
        [
          { principalId: a.principalId, addedBy: 'api' },
          { principalId: b.principalId, addedBy: 'manual' },
        ].sort((x, y) => x.principalId.localeCompare(y.principalId))
      )
      const audit = (await segmentAudit(seg.id, 'segment.member.added')).filter(
        (r) => r.metadata.source === 'api'
      )
      expect(audit.map((r) => r.metadata.principalId).sort()).toEqual(
        [a.principalId, b.principalId].sort()
      )
      await rest.dispose()
      await api.dispose()
    }
  )

  test(
    'PPL-G-28 REST removes people by slug whatever the source',
    { tag: '@core' },
    async ({ playwright, marker }) => {
      const api = await personApi(playwright, 'admin')
      const rest = await restAdmin(playwright)
      const seg = await createSegment(api, { name: `Off ${marker}`, type: 'manual' })
      const member = await portalUserRow(marker)
      const stays = await portalUserRow(marker)
      await mustCall(api, 'assignUsersToSegmentFn', {
        segmentId: seg.id,
        principalIds: [member.principalId, stays.principalId],
      })
      const body = await expectJson(
        await rest.delete(`/api/v1/segments/${seg.slug}/members`, {
          data: { principalIds: [member.principalId] },
        }),
        200
      )
      expect(body.data).toEqual({ removed: 1, failed: [] })
      expect(await memberIds(seg.id)).toEqual([stays.principalId])
      await rest.dispose()
      await api.dispose()
    }
  )

  test(
    'PPL-G-28 removing a non-member is not counted as a removal',
    {
      tag: ['@core', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'DELETE /api/v1/segments/:slug/members counts every settled delete, including people who were not members ($slug.members.ts); see QUARANTINE.md',
      },
    },
    async ({ playwright, marker }) => {
      const api = await personApi(playwright, 'admin')
      const rest = await restAdmin(playwright)
      const seg = await createSegment(api, { name: `Count ${marker}`, type: 'manual' })
      const member = await portalUserRow(marker)
      const stranger = await portalUserRow(marker)
      await mustCall(api, 'assignUsersToSegmentFn', {
        segmentId: seg.id,
        principalIds: [member.principalId],
      })
      const body = await expectJson(
        await rest.delete(`/api/v1/segments/${seg.slug}/members`, {
          data: { principalIds: [member.principalId, stranger.principalId] },
        }),
        200
      )
      expect(body.data).toEqual({ removed: 1, failed: [] })
      await rest.dispose()
      await api.dispose()
    }
  )

  test('PPL-G-30 REST members refusals', { tag: '@core' }, async ({ playwright, marker }) => {
    const api = await personApi(playwright, 'admin')
    const rest = await restAdmin(playwright)
    const seg = await createSegment(api, { name: `Ref ${marker}`, type: 'manual' })
    const gone = await createSegment(api, { name: `Gone ${marker}`, type: 'manual' })
    await mustCall(api, 'deleteSegmentFn', { segmentId: gone.id })
    const person = await portalUserRow(marker)
    const url = (slug: string) => `/api/v1/segments/${slug}/members`
    const data = { principalIds: [person.principalId] }

    for (const slug of [`missing-${marker}`, gone.slug]) {
      const res = await expectJson(await rest.post(url(slug), { data }), 404)
      expect(res.error.code, slug).toBe('NOT_FOUND')
      expect(res.error.message).toBe('Segment not found')
    }
    for (const bad of [
      { principalIds: [] },
      { principalIds: Array.from({ length: 1001 }, () => person.principalId) },
      {},
    ]) {
      const res = await expectJson(await rest.post(url(seg.slug), { data: bad }), 400)
      expect(res.error.code).toBe('BAD_REQUEST')
    }
    const contributor = await restAs(playwright, 'contributor')
    const forbidden = await expectJson(await contributor.post(url(seg.slug), { data }), 403)
    expect(forbidden.error.message).toContain('segment.manage')
    const anonymous = await apiFor(playwright, supportEnv().baseUrl, null)
    expect((await anonymous.post(url(seg.slug), { data })).status()).toBe(401)
    expect(await membersOf(seg.id)).toEqual([])
    await Promise.all([rest.dispose(), api.dispose(), contributor.dispose(), anonymous.dispose()])
  })

  test(
    'PPL-G-30 a body that is not JSON is a 400, not a server error',
    {
      tag: ['@core', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'request.json() throws a SyntaxError that the route does not map, so handleDomainError answers 500 ($slug.members.ts); see QUARANTINE.md',
      },
    },
    async ({ playwright, marker }) => {
      const api = await personApi(playwright, 'admin')
      const rest = await restAdmin(playwright)
      const seg = await createSegment(api, { name: `Json ${marker}`, type: 'manual' })
      const res = await rest.post(`/api/v1/segments/${seg.slug}/members`, {
        headers: { 'content-type': 'application/json' },
        data: Buffer.from('{not json'),
      })
      expect(res.status(), await res.text()).toBe(400)
      await rest.dispose()
      await api.dispose()
    }
  )
})

test.describe('segment permissions', () => {
  test(
    'PPL-G-44 every segment write is refused without segment.manage',
    { tag: '@core' },
    async ({ playwright, marker, newTeammate }) => {
      const admin = await personApi(playwright, 'admin')
      const manual = await createSegment(admin, { name: `Kept ${marker}`, type: 'manual' })
      const dynamic = await createSegment(admin, {
        name: `KeptDyn ${marker}`,
        type: 'dynamic',
        conditions: [{ attribute: 'email', operator: 'contains', value: marker }],
      })
      const member = await portalUserRow(marker)
      const other = await portalUserRow(marker)
      await mustCall(admin, 'assignUsersToSegmentFn', {
        segmentId: manual.id,
        principalIds: [member.principalId],
      })

      const mate = await newTeammate({ roleKey: 'contributor' })
      const api = await mate.api(playwright)
      // A contributor can read segments.
      await mustCall(api, 'listSegmentsFn', undefined, { method: 'GET' })

      await refusedCall(api, 'createSegmentFn', { name: `New ${marker}`, type: 'manual' })
      await refusedCall(api, 'updateSegmentFn', { segmentId: manual.id, name: `Renamed ${marker}` })
      await refusedCall(api, 'assignUsersToSegmentFn', {
        segmentId: manual.id,
        principalIds: [other.principalId],
      })
      await refusedCall(api, 'removeUsersFromSegmentFn', {
        segmentId: manual.id,
        principalIds: [member.principalId],
      })
      await refusedCall(api, 'evaluateSegmentFn', { segmentId: dynamic.id })
      await refusedCall(api, 'evaluateAllSegmentsFn')
      await refusedCall(api, 'deleteSegmentFn', { segmentId: manual.id })

      const created = await supportDb()`SELECT id FROM segments WHERE name = ${`New ${marker}`}`
      expect(created).toHaveLength(0)
      const row = await segmentRow(manual.id)
      expect(row).toMatchObject({ name: `Kept ${marker}`, deleted_at: null })
      expect(await memberIds(manual.id)).toEqual([member.principalId])
      expect(await memberIds(dynamic.id), 'not evaluated').toEqual([])
      await api.dispose()
      await admin.dispose()
    }
  )
})

test.describe('segment rules and lifecycle (nightly)', () => {
  test(
    'PPL-G-02 segment slugs are unique and a deleted segment frees its slug',
    { tag: '@nightly' },
    async ({ playwright, marker }) => {
      const admin = await personApi(playwright, 'admin')
      const name = `Enterprise ${marker}`
      const first = await createSegment(admin, { name, type: 'manual' })
      const second = await createSegment(admin, { name, type: 'manual' })
      expect(first.slug).toBe(`enterprise-${marker}`)
      expect(second.slug).toBe(`enterprise-${marker}-2`)
      await mustCall(admin, 'deleteSegmentFn', { segmentId: first.id })
      const third = await createSegment(admin, { name, type: 'manual' })
      expect(third.slug).toBe(`enterprise-${marker}`)
      await admin.dispose()
    }
  )

  test(
    'PPL-G-09 match all is the intersection, any the union; no buildable rule empties it',
    { tag: '@nightly' },
    async ({ playwright, marker }) => {
      const admin = await personApi(playwright, 'admin')
      const both = await portalUserRow(`${marker}-a`, { name: `Bee ${marker} 1` })
      const emailOnly = await portalUserRow(`${marker}-a`)
      const nameOnly = await portalUserRow(`${marker}-c`, { name: `Bee ${marker} 2` })
      const conditions: SegmentCondition[] = [
        { attribute: 'email', operator: 'contains', value: `${marker}-a` },
        { attribute: 'name', operator: 'contains', value: `Bee ${marker}` },
      ]
      const all = await createSegment(admin, {
        name: `All ${marker}`,
        type: 'dynamic',
        match: 'all',
        conditions,
      })
      await evaluate(admin, all.id)
      expect(await memberIds(all.id)).toEqual([both.principalId])

      const any = await createSegment(admin, {
        name: `Any ${marker}`,
        type: 'dynamic',
        match: 'any',
        conditions,
      })
      await evaluate(admin, any.id)
      expect(await memberIds(any.id)).toEqual(
        [both.principalId, emailOnly.principalId, nameOnly.principalId].sort()
      )

      // A metadata rule with no key cannot be built: nothing matches, and
      // the existing dynamic members are removed.
      await mustCall(admin, 'updateSegmentFn', {
        segmentId: any.id,
        rules: {
          match: 'any',
          conditions: [{ attribute: 'metadata_key', operator: 'eq', value: 'x' }],
        },
      })
      expect(await evaluate(admin, any.id)).toMatchObject({ added: 0, removed: 3 })
      expect(await memberIds(any.id)).toEqual([])
      await admin.dispose()
    }
  )

  test(
    'PPL-G-11 evaluation keeps members it did not add',
    { tag: '@nightly' },
    async ({ playwright, marker }) => {
      const admin = await personApi(playwright, 'admin')
      const rest = await restAdmin(playwright)
      const match = await portalUserRow(`${marker}-in`)
      const pinned = await portalUserRow(`${marker}-out`)
      const seg = await createSegment(admin, {
        name: `Kept ${marker}`,
        type: 'dynamic',
        conditions: [{ attribute: 'email', operator: 'contains', value: `${marker}-in` }],
      })
      await expectJson(
        await rest.post(`/api/v1/segments/${seg.slug}/members`, {
          data: { principalIds: [pinned.principalId] },
        }),
        200
      )
      expect(await evaluate(admin, seg.id)).toMatchObject({ added: 1, removed: 0 })
      expect(await membersOf(seg.id)).toEqual(
        [
          { principalId: match.principalId, addedBy: 'dynamic' },
          { principalId: pinned.principalId, addedBy: 'api' },
        ].sort((x, y) => x.principalId.localeCompare(y.principalId))
      )
      await rest.dispose()
      await admin.dispose()
    }
  )

  test(
    'PPL-G-11 a matching member held by another source is not counted as added again',
    {
      tag: ['@nightly', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'evaluateDynamicSegment diffs only dynamic rows, so a matching api/widget member is "added" on every run though the insert is a no-op (segment.evaluation.ts); see QUARANTINE.md',
      },
    },
    async ({ playwright, marker }) => {
      const admin = await personApi(playwright, 'admin')
      const rest = await restAdmin(playwright)
      const match = await portalUserRow(marker)
      const seg = await createSegment(admin, {
        name: `Over ${marker}`,
        type: 'dynamic',
        conditions: [{ attribute: 'email', operator: 'contains', value: marker }],
      })
      await expectJson(
        await rest.post(`/api/v1/segments/${seg.slug}/members`, {
          data: { principalIds: [match.principalId] },
        }),
        200
      )
      expect(await evaluate(admin, seg.id)).toMatchObject({ added: 0, removed: 0 })
      await rest.dispose()
      await admin.dispose()
    }
  )

  test(
    'PPL-G-12 the segment-evaluation job runs scheduled segments only',
    { tag: '@nightly' },
    async ({ playwright, request, marker }) => {
      const admin = await personApi(playwright, 'admin')
      const person = await portalUserRow(marker)
      const rule: SegmentCondition[] = [{ attribute: 'email', operator: 'eq', value: person.email }]
      const hourly = await createSegment(admin, {
        name: `Hourly ${marker}`,
        type: 'dynamic',
        conditions: rule,
        schedule: { enabled: true, pattern: '0 * * * *' },
      })
      const off = await createSegment(admin, {
        name: `Off ${marker}`,
        type: 'dynamic',
        conditions: rule,
        schedule: { enabled: false, pattern: '0 * * * *' },
      })
      const broken = await createSegment(admin, {
        name: `Broken ${marker}`,
        type: 'dynamic',
        conditions: rule,
      })
      // A stored pattern the cron parser rejects (written directly: whether
      // saving one should be refused is PPL-G-13).
      await supportDb()`UPDATE segments
        SET evaluation_schedule = ${JSON.stringify({ enabled: true, pattern: '99 99 * * *' })}::text::jsonb
        WHERE id = ${toUuid(broken.id as `segment_${string}`)}`

      const run = await runSweep(request, 'segment-evaluation')
      const evaluated = run.result.evaluated as string[]
      expect(evaluated).toContain(hourly.id)
      expect(evaluated).not.toContain(off.id)
      expect(evaluated).not.toContain(broken.id)
      expect(await membersOf(hourly.id)).toEqual([
        { principalId: person.principalId, addedBy: 'dynamic' },
      ])
      expect(await memberIds(off.id)).toEqual([])
      expect(await memberIds(broken.id)).toEqual([])
      await admin.dispose()
    }
  )

  test(
    'PPL-G-13 a schedule that is not a cron expression is refused',
    { tag: '@nightly' },
    async ({ playwright, marker }) => {
      const admin = await personApi(playwright, 'admin')
      const res = await refusedCall(admin, 'createSegmentFn', {
        name: `Cron ${marker}`,
        type: 'dynamic',
        rules: {
          match: 'all',
          conditions: [{ attribute: 'email', operator: 'contains', value: marker }],
        },
        evaluationSchedule: { enabled: true, pattern: 'every hour' },
      })
      expect(res.error).toContain('Must be a valid cron expression')
      const rows = await supportDb()`SELECT id FROM segments WHERE name = ${`Cron ${marker}`}`
      expect(rows).toHaveLength(0)
      await admin.dispose()
    }
  )

  test(
    'PPL-G-13 a schedule the scheduler cannot parse is refused on save',
    {
      tag: ['@nightly', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'CRON_REGEX (functions/admin.ts) accepts patterns parseCron rejects, so the segment saves and silently never auto-evaluates; see QUARANTINE.md',
      },
    },
    async ({ playwright, marker }) => {
      const admin = await personApi(playwright, 'admin')
      await refusedCall(admin, 'createSegmentFn', {
        name: `Cron ${marker}`,
        type: 'dynamic',
        rules: {
          match: 'all',
          conditions: [{ attribute: 'email', operator: 'contains', value: marker }],
        },
        evaluationSchedule: { enabled: true, pattern: '99 99 * * *' },
      })
      const rows = await supportDb()`SELECT id FROM segments WHERE name = ${`Cron ${marker}`}`
      expect(rows).toHaveLength(0)
      await admin.dispose()
    }
  )

  test(
    "PPL-G-15 clearing a dynamic segment's rules is refused and keeps its members",
    {
      tag: ['@nightly', '@quarantine'],
      annotation: {
        type: 'quarantine',
        description:
          'updateSegment accepts rules: null on a dynamic segment (segment.service.ts), and the next evaluation removes every member; see QUARANTINE.md',
      },
    },
    async ({ playwright, marker }) => {
      const admin = await personApi(playwright, 'admin')
      const person = await portalUserRow(marker)
      const seg = await createSegment(admin, {
        name: `Clear ${marker}`,
        type: 'dynamic',
        conditions: [{ attribute: 'email', operator: 'eq', value: person.email }],
      })
      await evaluate(admin, seg.id)
      expect(await memberIds(seg.id)).toEqual([person.principalId])

      const res = await callServerFn(admin, 'updateSegmentFn', { segmentId: seg.id, rules: null })
      await evaluate(admin, seg.id)
      expect(await memberIds(seg.id), 'members kept').toEqual([person.principalId])
      expect(res.ok, 'clearing the rules is refused').toBe(false)
      await admin.dispose()
    }
  )

  test(
    'PPL-G-19 unknown or deleted segment ids are refused; a manual one cannot be evaluated',
    { tag: '@nightly' },
    async ({ playwright, marker }) => {
      const admin = await personApi(playwright, 'admin')
      const person = await portalUserRow(marker)
      const manual = await createSegment(admin, { name: `Man ${marker}`, type: 'manual' })
      const deleted = await createSegment(admin, { name: `Del ${marker}`, type: 'manual' })
      await mustCall(admin, 'deleteSegmentFn', { segmentId: deleted.id })

      for (const segmentId of [generateId('segment'), deleted.id]) {
        for (const [fn, data] of [
          ['updateSegmentFn', { segmentId, name: `X ${marker}` }],
          ['deleteSegmentFn', { segmentId }],
          ['assignUsersToSegmentFn', { segmentId, principalIds: [person.principalId] }],
          ['removeUsersFromSegmentFn', { segmentId, principalIds: [person.principalId] }],
          ['evaluateSegmentFn', { segmentId }],
        ] as const) {
          const res = await refusedCall(admin, fn, data)
          expect(res.code, `${fn} ${segmentId}`).toBe('SEGMENT_NOT_FOUND')
        }
      }
      const manualEval = await refusedCall(admin, 'evaluateSegmentFn', { segmentId: manual.id })
      expect(manualEval.code).toBe('SEGMENT_TYPE_ERROR')
      expect(manualEval.error).toContain('Segment is not dynamic')
      await admin.dispose()
    }
  )

  test(
    'PPL-G-23 bulk assign skips unknown ids and reports the real count',
    { tag: '@nightly' },
    async ({ playwright, marker }) => {
      const admin = await personApi(playwright, 'admin')
      const seg = await createSegment(admin, { name: `Bulk ${marker}`, type: 'manual' })
      const person = await portalUserRow(marker)
      const anon = await seedAnonymous(marker)
      const one = await mustCall<{ assigned: number }>(admin, 'assignUsersToSegmentFn', {
        segmentId: seg.id,
        principalIds: [person.principalId, generateId('principal')],
      })
      expect(one).toMatchObject({ segmentId: seg.id, assigned: 1 })
      const anonymous = await mustCall<{ assigned: number }>(admin, 'assignUsersToSegmentFn', {
        segmentId: seg.id,
        principalIds: [anon.principalId],
      })
      expect(anonymous.assigned).toBe(1)
      await refusedCall(admin, 'assignUsersToSegmentFn', { segmentId: seg.id, principalIds: [] })
      expect(await memberIds(seg.id)).toEqual([person.principalId, anon.principalId].sort())
      await admin.dispose()
    }
  )

  test(
    "PPL-G-31 list a segment's members through the users REST endpoint",
    { tag: '@nightly' },
    async ({ playwright, marker }) => {
      const admin = await personApi(playwright, 'admin')
      const rest = await restAdmin(playwright)
      const segA = await createSegment(admin, { name: `RA ${marker}`, type: 'manual' })
      const segB = await createSegment(admin, { name: `RB ${marker}`, type: 'manual' })
      const a = await portalUserRow(marker)
      const b = await portalUserRow(marker)
      const ab = await portalUserRow(marker)
      await portalUserRow(marker) // in neither segment
      await mustCall(admin, 'assignUsersToSegmentFn', {
        segmentId: segA.id,
        principalIds: [a.principalId, ab.principalId],
      })
      await mustCall(admin, 'assignUsersToSegmentFn', {
        segmentId: segB.id,
        principalIds: [b.principalId, ab.principalId],
      })
      const url = (cursor?: string) =>
        `/api/v1/users?segmentIds=${segA.id},${segB.id}&limit=2${cursor ? `&cursor=${cursor}` : ''}`
      const first = await expectJson(await rest.get(url()), 200)
      expect(first.data).toHaveLength(2)
      expect(first.meta.pagination).toMatchObject({ hasMore: true, total: 3 })
      const second = await expectJson(await rest.get(url(first.meta.pagination.cursor)), 200)
      expect(second.meta.pagination.hasMore).toBe(false)
      const ids = [...first.data, ...second.data].map((u: { principalId: string }) => u.principalId)
      expect(ids.sort()).toEqual([a.principalId, b.principalId, ab.principalId].sort())
      await rest.dispose()
      await admin.dispose()
    }
  )

  test(
    'PPL-G-45 segment reads are refused without segment.view',
    { tag: '@nightly' },
    async ({ playwright, marker, newTeammate }) => {
      const roleKey = await createRole(marker, ['member.view'])
      const mate = await newTeammate({ roleKey })
      const api = await mate.api(playwright)
      await refusedCall(api, 'listSegmentsFn', undefined, { method: 'GET' })
      await refusedCall(
        api,
        'fetchSegmentAttributeValuesFn',
        { attribute: 'email', query: '' },
        { method: 'GET' }
      )
      // The same read works for a segment.view holder.
      const contributor = await newTeammate({ roleKey: 'contributor' })
      const allowed = await contributor.api(playwright)
      await mustCall(allowed, 'listSegmentsFn', undefined, { method: 'GET' })
      await api.dispose()
      await allowed.dispose()
    }
  )
})
