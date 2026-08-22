import { describe, it, expect } from 'vitest'
import { parseJsonConfig } from '../settings.helpers'
import {
  DEFAULT_PORTAL_CONFIG,
  EMPTY_WELCOME_BODY,
  type PortalConfig,
  type PortalWelcomeCard,
  type PublicPortalConfig,
} from '../settings.types'

describe('PortalWelcomeCard defaults', () => {
  it('has an empty doc body by default (card hidden)', () => {
    expect(DEFAULT_PORTAL_CONFIG.welcomeCard?.body).toEqual(EMPTY_WELCOME_BODY)
  })
})

describe('PortalWelcomeCard type', () => {
  it('accepts a fully-specified welcome card', () => {
    const card: PortalWelcomeCard = {
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
    expect(card.body.content?.[0]?.content?.[0]?.text).toContain('Tell us')
  })

  it('is exposed as an optional field on PortalConfig', () => {
    const cfg: PortalConfig = {
      ...DEFAULT_PORTAL_CONFIG,
      welcomeCard: { body: { type: 'doc' } as never },
    }
    expect(cfg.welcomeCard?.body.type).toBe('doc')
  })

  it('is exposed on PublicPortalConfig so the portal SSR loader can read it', () => {
    const projection: PublicPortalConfig = {
      features: DEFAULT_PORTAL_CONFIG.features,
      openSignup: true,
      welcomeCard: { body: { type: 'doc' } as never },
    }
    expect(projection.welcomeCard?.body.type).toBe('doc')
  })
})

describe('parseJsonConfig deep-merges welcomeCard', () => {
  it('preserves welcomeCard defaults when stored config omits it', () => {
    const stored = JSON.stringify({ features: { allowAnonymous: false } })
    const result = parseJsonConfig(stored, DEFAULT_PORTAL_CONFIG)
    expect(result.welcomeCard).toEqual(DEFAULT_PORTAL_CONFIG.welcomeCard)
  })

  it('merges a partial welcomeCard body over the empty default', () => {
    const stored = JSON.stringify({
      welcomeCard: {
        body: {
          type: 'doc',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
        },
      },
    })
    const result = parseJsonConfig(stored, DEFAULT_PORTAL_CONFIG)
    expect(result.welcomeCard?.body.content?.[0]?.content?.[0]?.text).toBe('Hello')
  })
})
