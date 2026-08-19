/**
 * Real-DB coverage for the conversation-attribute registry: key normalization,
 * unique keys (archived keys stay reserved), per-type option rules, option
 * append/rename-by-id (never removal), and the archive/restore lifecycle.
 * Runs inside the db-test-fixture rollback transaction.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest'

import { createDbTestFixture } from '@/lib/server/__tests__/db-test-fixture'
import { conversationAttributeDefinitions } from '@/lib/server/db'

vi.mock('@/lib/server/db', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/db')>()),
  db: (await import('@/lib/server/__tests__/db-test-fixture')).testDb,
}))

import {
  normalizeAttributeKey,
  listConversationAttributes,
  createConversationAttribute,
  updateConversationAttribute,
  archiveConversationAttribute,
  restoreConversationAttribute,
} from '../conversation-attribute.service'

const fixture = await createDbTestFixture({
  probe: async (db) => {
    await db
      .select({ id: conversationAttributeDefinitions.id })
      .from(conversationAttributeDefinitions)
      .limit(0)
  },
})

describe('normalizeAttributeKey', () => {
  it('lowercases, trims, and snake_cases whitespace', () => {
    expect(normalizeAttributeKey('  Issue Type ')).toBe('issue_type')
    expect(normalizeAttributeKey('MRR')).toBe('mrr')
  })
})

describe.skipIf(!fixture.available)(
  'conversation-attribute registry (real DB, rolled back)',
  () => {
    beforeEach(fixture.begin)
    afterEach(fixture.rollback)
    afterAll(fixture.close)

    it('creates a text attribute with a normalized key', async () => {
      // 'issue_type' is now a seeded system key (0178 migration), so this
      // generic normalization test uses an unrelated key.
      const created = await createConversationAttribute({
        key: 'Ticket Category',
        label: 'Ticket category',
        description: 'What the conversation is about',
        fieldType: 'text',
      })
      expect(created.key).toBe('ticket_category')
      expect(created.fieldType).toBe('text')
      expect(created.options).toBeNull()
      expect(created.requiredToClose).toBe(false)
      expect(created.archivedAt).toBeNull()
    })

    it('creates a select attribute with generated stable option ids', async () => {
      const created = await createConversationAttribute({
        key: 'severity',
        label: 'Severity',
        fieldType: 'select',
        options: [
          { label: 'Low', description: 'Cosmetic' },
          { label: 'High', description: 'Blocking' },
        ],
      })
      expect(created.options).toHaveLength(2)
      const ids = created.options!.map((o) => o.id)
      expect(new Set(ids).size).toBe(2)
      expect(ids.every((id) => id.length > 0)).toBe(true)
      expect(created.options![0]).toMatchObject({ label: 'Low', description: 'Cosmetic' })
    })

    it('rejects options on scalar types and requires them on select types', async () => {
      await expect(
        createConversationAttribute({
          key: 'count',
          label: 'Count',
          fieldType: 'number',
          options: [{ label: 'One' }],
        })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
      await expect(
        createConversationAttribute({ key: 'sev', label: 'Sev', fieldType: 'select' })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    })

    it('rejects a duplicate key, including one held by an archived definition', async () => {
      const created = await createConversationAttribute({
        key: 'plan',
        label: 'Plan',
        fieldType: 'text',
      })
      await archiveConversationAttribute(created.id)
      // Archived definitions keep their key reserved.
      await expect(
        createConversationAttribute({ key: 'Plan', label: 'Plan again', fieldType: 'number' })
      ).rejects.toMatchObject({ code: 'DUPLICATE_KEY' })
    })

    it('appends and renames options by id but never drops one', async () => {
      const created = await createConversationAttribute({
        key: 'severity',
        label: 'Severity',
        fieldType: 'select',
        options: [{ label: 'Low' }, { label: 'High' }],
      })
      const [low, high] = created.options!

      const updated = await updateConversationAttribute(created.id, {
        options: [
          { id: low.id, label: 'Minor', description: 'Renamed' },
          { id: high.id, label: 'High' },
          { label: 'Critical' },
        ],
      })
      expect(updated.options).toHaveLength(3)
      expect(updated.options![0]).toMatchObject({
        id: low.id,
        label: 'Minor',
        description: 'Renamed',
      })
      expect(updated.options![2].id).not.toBe(low.id)

      // Omitting an existing option id is a removal — refused (values store ids).
      await expect(
        updateConversationAttribute(created.id, { options: [{ id: low.id, label: 'Minor' }] })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
      // Unknown ids can't be smuggled in either.
      await expect(
        updateConversationAttribute(created.id, {
          options: [
            { id: low.id, label: 'Minor' },
            { id: high.id, label: 'High' },
            { id: 'opt_unknown', label: 'Ghost' },
          ],
        })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    })

    it('keeps the field type immutable', async () => {
      const created = await createConversationAttribute({
        key: 'plan',
        label: 'Plan',
        fieldType: 'text',
      })
      await expect(
        updateConversationAttribute(created.id, {
          fieldType: 'number',
        } as unknown as Parameters<typeof updateConversationAttribute>[1])
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    })

    it('accepts aiDetect/detectOnClose on a select attribute and exposes them on the type', async () => {
      const created = await createConversationAttribute({
        key: 'issue_type_2',
        label: 'Issue type 2',
        fieldType: 'select',
        options: [{ label: 'Billing' }, { label: 'Bug' }],
        aiDetect: true,
        detectOnClose: true,
      })
      expect(created.aiDetect).toBe(true)
      expect(created.detectOnClose).toBe(true)
    })

    it('defaults aiDetect ON (and detectOnClose off) for a select attribute when omitted', async () => {
      const created = await createConversationAttribute({
        key: 'issue_type_3',
        label: 'Issue type 3',
        fieldType: 'select',
        options: [{ label: 'Billing' }],
      })
      expect(created.aiDetect).toBe(true)
      expect(created.detectOnClose).toBe(false)
    })

    it('defaults aiDetect off for a non-select attribute when omitted', async () => {
      const created = await createConversationAttribute({
        key: 'plan_default',
        label: 'Plan',
        fieldType: 'text',
      })
      expect(created.aiDetect).toBe(false)
      expect(created.detectOnClose).toBe(false)
    })

    it('an explicit aiDetect=false on a select attribute overrides the default', async () => {
      const created = await createConversationAttribute({
        key: 'issue_type_optout',
        label: 'Issue type opt-out',
        fieldType: 'select',
        options: [{ label: 'Billing' }],
        aiDetect: false,
      })
      expect(created.aiDetect).toBe(false)
    })

    it('rejects aiDetect on a non-select field type', async () => {
      await expect(
        createConversationAttribute({
          key: 'plan_ai',
          label: 'Plan',
          fieldType: 'text',
          aiDetect: true,
        })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    })

    it('rejects detectOnClose on a non-select field type', async () => {
      await expect(
        createConversationAttribute({
          key: 'plan_close',
          label: 'Plan',
          fieldType: 'number',
          detectOnClose: true,
        })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    })

    it('allows updating aiDetect/detectOnClose on an existing select attribute', async () => {
      const created = await createConversationAttribute({
        key: 'issue_type_4',
        label: 'Issue type 4',
        fieldType: 'select',
        options: [{ label: 'Billing' }],
      })
      const updated = await updateConversationAttribute(created.id, {
        aiDetect: true,
        detectOnClose: true,
      })
      expect(updated.aiDetect).toBe(true)
      expect(updated.detectOnClose).toBe(true)
    })

    it('rejects updating aiDetect on a non-select existing attribute', async () => {
      const created = await createConversationAttribute({
        key: 'plan_update',
        label: 'Plan',
        fieldType: 'text',
      })
      await expect(
        updateConversationAttribute(created.id, { aiDetect: true })
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    })

    it('lists only aiDetect-enabled definitions when filtered', async () => {
      await createConversationAttribute({
        key: 'issue_type_5',
        label: 'Issue type 5',
        fieldType: 'select',
        options: [{ label: 'Billing' }],
        aiDetect: true,
      })
      await createConversationAttribute({
        key: 'issue_type_6',
        label: 'Issue type 6',
        fieldType: 'select',
        options: [{ label: 'Billing' }],
        aiDetect: false,
      })
      const aiDetectOnly = await listConversationAttributes({ aiDetectOnly: true })
      expect(aiDetectOnly.some((a) => a.key === 'issue_type_5')).toBe(true)
      expect(aiDetectOnly.some((a) => a.key === 'issue_type_6')).toBe(false)
    })

    it('archives (hidden from the default list) and restores', async () => {
      const created = await createConversationAttribute({
        key: 'plan',
        label: 'Plan',
        fieldType: 'text',
      })
      const archived = await archiveConversationAttribute(created.id)
      expect(archived.archivedAt).not.toBeNull()

      const defaultList = await listConversationAttributes()
      expect(defaultList.find((a) => a.id === created.id)).toBeUndefined()
      const fullList = await listConversationAttributes({ includeArchived: true })
      expect(fullList.find((a) => a.id === created.id)).toBeDefined()

      const restored = await restoreConversationAttribute(created.id)
      expect(restored.archivedAt).toBeNull()
      const listAgain = await listConversationAttributes()
      expect(listAgain.find((a) => a.id === created.id)).toBeDefined()
    })
  }
)
