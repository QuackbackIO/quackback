/**
 * Catalog capability derivation (IF WO-4): badges come from the definition's
 * slots, so the catalog cannot advertise what a provider doesn't implement.
 * Regression anchor: Monday/Notion historically claimed "Two-way status
 * sync" with no inbound handler.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  getConfiguredIntegrationTypes: vi.fn().mockResolvedValue(new Set<string>()),
}))

import { getIntegrationCatalog } from '../index'

describe('getIntegrationCatalog capability derivation', () => {
  it('monday and notion no longer advertise two-way status sync', async () => {
    const catalog = await getIntegrationCatalog()
    for (const id of ['monday', 'notion']) {
      const entry = catalog.find((e) => e.id === id)!
      const labels = (entry.capabilities ?? []).map((c) => c.label)
      expect(labels, `${id} has no inbound handler`).not.toContain('Two-way status sync')
      // They do create items and clean up on delete — slots they really have.
      expect(labels).toContain('Create items from feedback')
      expect(labels).toContain('Clean up on delete')
    }
  })

  it('full trackers advertise the full loop', async () => {
    const catalog = await getIntegrationCatalog()
    const linear = catalog.find((e) => e.id === 'linear')!
    const labels = (linear.capabilities ?? []).map((c) => c.label)
    expect(labels).toEqual(
      expect.arrayContaining([
        'Create items from feedback',
        'Two-way status sync',
        'Link existing items',
        'Clean up on delete',
      ])
    )
  })

  it('support_crm hooks derive as customer context, not delivery', async () => {
    const catalog = await getIntegrationCatalog()
    for (const id of ['freshdesk', 'salesforce', 'stripe']) {
      const labels = (catalog.find((e) => e.id === id)!.capabilities ?? []).map((c) => c.label)
      expect(labels, id).toContain('Customer context')
      expect(labels, id).not.toContain('Create items from feedback')
    }
  })

  it('zero-slot providers keep their hand-written fallback copy', async () => {
    const catalog = await getIntegrationCatalog()
    for (const id of ['zendesk', 'intercom', 'hubspot']) {
      const entry = catalog.find((e) => e.id === id)!
      expect(
        (entry.capabilities ?? []).length,
        `${id} should fall back to hand-written copy until the context capability lands`
      ).toBeGreaterThan(0)
    }
  })

  it('every capability entry has label and description copy', async () => {
    const catalog = await getIntegrationCatalog()
    for (const entry of catalog) {
      for (const cap of entry.capabilities ?? []) {
        expect(cap.label.length, entry.id).toBeGreaterThan(0)
        expect(cap.description.length, entry.id).toBeGreaterThan(0)
      }
    }
  })
})
