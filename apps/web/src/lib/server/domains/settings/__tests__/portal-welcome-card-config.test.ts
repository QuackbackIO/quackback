import { describe, it, expect } from 'vitest'
import { parseJsonConfig } from '../settings.helpers'
import {
  DEFAULT_PORTAL_CONFIG,
  type PortalConfig,
  type PortalWelcomeCard,
  type PublicPortalConfig,
} from '../settings.types'

describe('PortalWelcomeCard defaults', () => {
  it('is off by default', () => {
    expect(DEFAULT_PORTAL_CONFIG.welcomeCard?.enabled).toBe(false)
  })

  it('has empty title by default', () => {
    expect(DEFAULT_PORTAL_CONFIG.welcomeCard?.title).toBe('')
  })

  it('has an empty doc body by default', () => {
    expect(DEFAULT_PORTAL_CONFIG.welcomeCard?.body).toEqual({
      type: 'doc',
      content: [{ type: 'paragraph' }],
    })
  })
})

describe('PortalWelcomeCard type', () => {
  it('accepts a fully-specified welcome card', () => {
    const card: PortalWelcomeCard = {
      enabled: true,
      title: 'Share your product feedback!',
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Tell us what you think.' }],
          },
        ],
      },
    }
    expect(card.enabled).toBe(true)
    expect(card.title).toContain('Share')
  })

  it('is exposed as an optional field on PortalConfig', () => {
    const cfg: PortalConfig = {
      ...DEFAULT_PORTAL_CONFIG,
      welcomeCard: { enabled: true, title: 'Hi', body: { type: 'doc' } as never },
    }
    expect(cfg.welcomeCard?.enabled).toBe(true)
  })

  it('is exposed on PublicPortalConfig so the portal SSR loader can read it', () => {
    const projection: PublicPortalConfig = {
      oauth: { password: true },
      features: DEFAULT_PORTAL_CONFIG.features,
      welcomeCard: { enabled: true, title: 'x', body: { type: 'doc' } as never },
    }
    expect(projection.welcomeCard?.title).toBe('x')
  })
})

describe('parseJsonConfig deep-merges welcomeCard', () => {
  it('preserves welcomeCard defaults when stored config omits it', () => {
    const stored = JSON.stringify({ features: { voting: false } })
    const result = parseJsonConfig(stored, DEFAULT_PORTAL_CONFIG)
    expect(result.welcomeCard).toEqual(DEFAULT_PORTAL_CONFIG.welcomeCard)
  })

  it('merges partial welcomeCard with defaults', () => {
    const stored = JSON.stringify({
      welcomeCard: { enabled: true, title: 'Hello' },
    })
    const result = parseJsonConfig(stored, DEFAULT_PORTAL_CONFIG)
    expect(result.welcomeCard?.enabled).toBe(true)
    expect(result.welcomeCard?.title).toBe('Hello')
    expect(result.welcomeCard?.body).toEqual(DEFAULT_PORTAL_CONFIG.welcomeCard?.body)
  })
})
