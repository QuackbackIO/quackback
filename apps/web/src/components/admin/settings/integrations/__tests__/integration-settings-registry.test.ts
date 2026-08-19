/**
 * IF WO-6 gate: the single `$type` settings route dispatches through
 * INTEGRATION_SETTINGS, so every catalog provider MUST have a registry entry
 * (or its settings page 404s), and no entry may dangle without a catalog. This
 * is the safety net that replaces 25 hand-written route files.
 */
import { describe, it, expect } from 'vitest'
import * as catalogs from '@/lib/shared/integration-catalog'
import { INTEGRATION_SETTINGS, getIntegrationSettingsEntry } from '../integration-settings-registry'

const catalogById = new Map(Object.values(catalogs).map((c) => [c.id, c] as const))

describe('integration settings registry (WO-6)', () => {
  it('has an entry for every catalog provider', () => {
    const missing = [...catalogById.keys()].filter((id) => !INTEGRATION_SETTINGS[id])
    expect(missing).toEqual([])
  })

  it('has no dangling entry without a catalog', () => {
    const dangling = Object.keys(INTEGRATION_SETTINGS).filter((type) => !catalogById.has(type))
    expect(dangling).toEqual([])
  })

  it('each entry is self-consistent (type is the key, catalog matches, connect actions present)', () => {
    for (const [key, entry] of Object.entries(INTEGRATION_SETTINGS)) {
      expect(entry.type, `${key}.type`).toBe(key)
      expect(entry.catalog.id, `${key}.catalog.id`).toBe(key)
      expect(entry.Icon, `${key}.Icon`).toBeTruthy()
      expect(entry.ConnectionActions, `${key}.ConnectionActions`).toBeTruthy()
      // A provider renders at most one connected surface — a config panel OR an
      // enrichment banner, never both. (Connect-only providers like Segment
      // legitimately have neither.)
      const hasConfig = typeof entry.renderConfig === 'function'
      const hasBanner = entry.connectedBanner != null
      expect(
        hasConfig && hasBanner,
        `${key} must not set both renderConfig and connectedBanner`
      ).toBe(false)
    }
  })

  it('lookup normalizes nothing beyond the exact type key', () => {
    expect(getIntegrationSettingsEntry('slack')).toBe(INTEGRATION_SETTINGS.slack)
    expect(getIntegrationSettingsEntry('does_not_exist')).toBeUndefined()
  })
})
