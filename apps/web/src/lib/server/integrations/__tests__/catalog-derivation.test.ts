/**
 * Catalog capability derivation (IF WO-4): badges come from the definition's
 * slots, so the catalog cannot advertise what a provider doesn't implement.
 * Regression anchor: Monday/Notion historically claimed "Two-way status
 * sync" with no inbound handler.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

const mockAreManaged = vi.fn().mockResolvedValue(false)
vi.mock('@/lib/server/domains/platform-credentials/platform-credential.service', () => ({
  getConfiguredIntegrationTypes: vi.fn().mockResolvedValue(new Set<string>()),
  arePlatformCredentialsManaged: (type: string) => mockAreManaged(type),
}))

import { getIntegrationCatalog } from '../index'

afterEach(() => {
  mockAreManaged.mockResolvedValue(false)
})

describe('getIntegrationCatalog capability derivation', () => {
  it('monday and notion no longer advertise two-way status sync', async () => {
    const catalog = await getIntegrationCatalog()
    for (const id of ['monday', 'notion']) {
      const entry = catalog.find((e) => e.id === id)!
      const labels = (entry.capabilities ?? []).map((c) => c.label)
      expect(labels, `${id} has no inbound handler`).not.toContain('Two-way status sync')
      // They do create items and clean up on delete — slots they really have.
      expect(labels).toContain('Create items from feedback')
      expect(labels).toContain('Review cleanup on delete')
    }
  })

  it('verified inbound trackers distinguish automatic updates from outbound review', async () => {
    const catalog = await getIntegrationCatalog()
    const linear = catalog.find((e) => e.id === 'linear')!
    const labels = (linear.capabilities ?? []).map((c) => c.label)
    expect(labels).toEqual(
      expect.arrayContaining([
        'Create items from feedback',
        'Receive status updates',
        'Review outbound status changes',
        'Link existing items',
        'Review cleanup on delete',
      ])
    )
  })

  it('review-only inbound adapters do not advertise automatic status updates', async () => {
    const catalog = await getIntegrationCatalog()
    for (const id of ['jira', 'azure_devops', 'asana', 'clickup', 'gitlab', 'shortcut', 'trello']) {
      const labels = catalog.find((entry) => entry.id === id)!.capabilities!.map((cap) => cap.label)
      expect(labels, id).toContain('Review status updates')
      expect(labels, id).not.toContain('Receive status updates')
    }
  })

  it('customer lookups derive from the context capability, not delivery', async () => {
    const catalog = await getIntegrationCatalog()
    for (const id of ['freshdesk', 'salesforce', 'stripe']) {
      const labels = (catalog.find((e) => e.id === id)!.capabilities ?? []).map((c) => c.label)
      expect(labels, id).toContain('Customer context')
      expect(labels, id).not.toContain('Create items from feedback')
    }
  })

  it('lookup providers advertise their implemented context capability', async () => {
    const catalog = await getIntegrationCatalog()
    for (const id of ['zendesk', 'intercom', 'hubspot']) {
      const entry = catalog.find((e) => e.id === id)!
      expect(
        (entry.capabilities ?? []).length,
        `${id} should expose its implemented customer context lookup`
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

  it('lets tenants connect platform-managed apps without pasting credentials', async () => {
    mockAreManaged.mockImplementation(async (type: string) => type === 'slack')
    const catalog = await getIntegrationCatalog()
    const slack = catalog.find((e) => e.id === 'slack')!
    expect(slack.managed).toBe(true)
    expect(slack.available).toBe(true)
    const github = catalog.find((e) => e.id === 'github')!
    expect(github.managed).toBe(false)
    expect(github.available).toBe(false)
  })
})
