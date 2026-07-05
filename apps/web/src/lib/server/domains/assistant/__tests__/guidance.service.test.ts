/**
 * Real-DB coverage for the guidance-rules service: create/list/toggle/reorder/
 * delete, the surface-scoping filter (a null-surfaces rule matches every
 * surface), and the title/body length guards at both the service and DB
 * layers. Runs inside the db-test-fixture rollback transaction.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'

import { createDbTestFixture, testDb } from '@/lib/server/__tests__/db-test-fixture'
import { assistantGuidanceRules } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import {
  createGuidanceRule,
  listGuidanceRules,
  updateGuidanceRule,
  reorderGuidanceRules,
  deleteGuidanceRule,
} from '../guidance.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db.select({ id: assistantGuidanceRules.id }).from(assistantGuidanceRules).limit(0)
  },
})

describe.skipIf(!fixture.available)('guidance.service (real DB, rolled back)', () => {
  beforeEach(fixture.begin)
  afterEach(fixture.rollback)
  afterAll(fixture.close)

  it('creates a rule and lists it back', async () => {
    const rule = await createGuidanceRule({ title: 'Refund policy', body: 'Always mention it.' })
    expect(rule.enabled).toBe(true)
    expect(rule.surfaces).toBeNull()
    expect(rule.position).toBe(0)
    expect(rule.category).toBe('other')

    const rules = await listGuidanceRules()
    expect(rules.map((r) => r.id)).toEqual([rule.id])
    expect(rules[0].category).toBe('other')
  })

  it('creates a rule with an explicit category', async () => {
    const rule = await createGuidanceRule({
      title: 'Tone',
      body: 'Be warm and concise.',
      category: 'communication_style',
    })
    expect(rule.category).toBe('communication_style')

    const [listed] = await listGuidanceRules()
    expect(listed.category).toBe('communication_style')
  })

  it('rejects an unknown category at the service layer', async () => {
    await expect(
      createGuidanceRule({
        title: 'Bad category',
        body: 'Body text.',
        category: 'not_a_real_category' as never,
      })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('updates a rule category', async () => {
    const rule = await createGuidanceRule({ title: 'Recategorize me', body: 'Body text.' })
    const updated = await updateGuidanceRule(rule.id, { category: 'spam' })
    expect(updated?.category).toBe('spam')
  })

  it('rejects an unknown category on update', async () => {
    const rule = await createGuidanceRule({ title: 'Recategorize me', body: 'Body text.' })
    await expect(
      updateGuidanceRule(rule.id, { category: 'not_a_real_category' as never })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('defaults category to other for a legacy row inserted without one', async () => {
    const [row] = await testDb
      .insert(assistantGuidanceRules)
      .values({ title: 'Legacy row', body: 'Predates categories.' })
      .returning()
    expect(row.category).toBe('other')

    const [listed] = await listGuidanceRules()
    expect(listed.category).toBe('other')
  })

  it('scopes the list to a surface; a null-surfaces rule matches every surface', async () => {
    const everywhere = await createGuidanceRule({ title: 'Everywhere', body: 'Applies always.' })
    const widgetOnly = await createGuidanceRule({
      title: 'Widget only',
      body: 'Widget-specific.',
      surfaces: ['widget'],
    })
    const emailOnly = await createGuidanceRule({
      title: 'Email only',
      body: 'Email-specific.',
      surfaces: ['email'],
    })

    const widgetRules = await listGuidanceRules({ surface: 'widget' })
    expect(widgetRules.map((r) => r.id).sort()).toEqual([everywhere.id, widgetOnly.id].sort())

    const emailRules = await listGuidanceRules({ surface: 'email' })
    expect(emailRules.map((r) => r.id).sort()).toEqual([everywhere.id, emailOnly.id].sort())
  })

  it('filters to enabled-only when asked', async () => {
    const enabled = await createGuidanceRule({ title: 'Enabled', body: 'Stays on.' })
    const disabled = await createGuidanceRule({ title: 'Disabled', body: 'Toggled off.' })
    await updateGuidanceRule(disabled.id, { enabled: false })

    const all = await listGuidanceRules()
    expect(all.map((r) => r.id).sort()).toEqual([enabled.id, disabled.id].sort())

    const enabledOnly = await listGuidanceRules({ enabledOnly: true })
    expect(enabledOnly.map((r) => r.id)).toEqual([enabled.id])
  })

  it('toggles enabled via updateGuidanceRule', async () => {
    const rule = await createGuidanceRule({ title: 'Toggle me', body: 'Body text.' })
    const updated = await updateGuidanceRule(rule.id, { enabled: false })
    expect(updated?.enabled).toBe(false)
    expect((await listGuidanceRules({ enabledOnly: true })).map((r) => r.id)).not.toContain(rule.id)
  })

  it('reorders rules to match the given id order', async () => {
    const a = await createGuidanceRule({ title: 'A', body: 'A body' })
    const b = await createGuidanceRule({ title: 'B', body: 'B body' })
    const c = await createGuidanceRule({ title: 'C', body: 'C body' })

    await reorderGuidanceRules([c.id, a.id, b.id])

    const ordered = await listGuidanceRules()
    expect(ordered.map((r) => r.id)).toEqual([c.id, a.id, b.id])
  })

  it('deletes a rule', async () => {
    const rule = await createGuidanceRule({ title: 'Temp', body: 'Delete me.' })
    await deleteGuidanceRule(rule.id)
    expect(await listGuidanceRules()).toHaveLength(0)
  })

  it('rejects a body over 1000 characters at the service layer', async () => {
    await expect(
      createGuidanceRule({ title: 'Too long', body: 'x'.repeat(1001) })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('rejects a title over 80 characters at the service layer', async () => {
    await expect(
      createGuidanceRule({ title: 'x'.repeat(81), body: 'Fine.' })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('DB CHECK constraint rejects an over-length body inserted directly', async () => {
    await expect(
      testDb.insert(assistantGuidanceRules).values({ title: 'Bypass service', body: 'x'.repeat(1001) })
    ).rejects.toThrow()
  })
})
