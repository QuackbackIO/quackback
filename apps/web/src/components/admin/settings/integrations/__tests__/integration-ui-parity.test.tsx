/**
 * UI manifest parity (IF WO-5). The manifest is the single source of truth
 * for per-provider presentation metadata; these gates keep it in sync with
 * the icon map and the server registry so a new provider can't ship with a
 * blank badge or an un-named cleanup action.
 */
import { describe, it, expect } from 'vitest'
import {
  INTEGRATION_UI,
  getIntegrationDisplayName,
  getIntegrationActionVerb,
  getIntegrationItemNoun,
  formatExternalId,
} from '../integration-ui'
import { INTEGRATION_ICON_MAP } from '@/components/icons/integration-icons'
import { getIntegration, listIntegrationTypes } from '@/lib/server/integrations'

describe('integration UI manifest parity', () => {
  it('covers exactly the icon-map providers', () => {
    expect(Object.keys(INTEGRATION_UI).sort()).toEqual(Object.keys(INTEGRATION_ICON_MAP).sort())
  })

  it('matches its own icon to the shared icon map', () => {
    for (const [id, manifest] of Object.entries(INTEGRATION_UI)) {
      expect(manifest.icon, `${id} icon differs from INTEGRATION_ICON_MAP`).toBe(
        INTEGRATION_ICON_MAP[id]
      )
    }
  })

  it('gives every registered provider a manifest, except icon-less segment', () => {
    for (const type of listIntegrationTypes()) {
      if (type === 'segment') continue // renders an inline "S" glyph, no brand icon
      expect(INTEGRATION_UI[type], `${type} is registered but has no UI manifest`).toBeDefined()
    }
  })

  it('gives every tracker (archive-capable provider) a verb and noun', () => {
    for (const type of listIntegrationTypes()) {
      if (!getIntegration(type)?.archive) continue
      const manifest = INTEGRATION_UI[type]
      expect(manifest?.actionVerb, `${type} archives but has no actionVerb`).toBeDefined()
      expect(manifest?.itemNoun, `${type} archives but has no itemNoun`).toBeDefined()
    }
  })
})

describe('manifest display helpers', () => {
  it('falls back to the raw type for an unknown display name', () => {
    expect(getIntegrationDisplayName('custom_tracker')).toBe('custom_tracker')
  })

  it('defaults action verb to Archive and item noun to issue for unknowns', () => {
    expect(getIntegrationActionVerb('something_else')).toBe('Archive')
    expect(getIntegrationItemNoun('something_else')).toBe('issue')
  })

  it('formats a github external id as #<n> and leaves others unchanged', () => {
    expect(formatExternalId('github', '42')).toBe('#42')
    expect(formatExternalId('jira', 'PROJ-1')).toBe('PROJ-1')
  })
})
