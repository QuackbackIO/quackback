import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'

const published = vi.hoisted(() => ({
  current: null as null | { document: unknown; number: number },
}))
const engine = vi.hoisted(() => ({ current: 'auto' as 'auto' | 'legacy' }))

vi.mock('@/lib/server/domains/design/design.service', () => ({
  getPublishedRevision: vi.fn(async () => published.current),
}))
vi.mock('@/lib/server/config', () => ({
  config: {
    get portalDesignEngine() {
      return engine.current
    },
  },
}))
vi.mock('@/lib/server/storage/s3', () => ({
  getEmailSafeUrl: (key: string | null | undefined) =>
    key ? `https://files.example/${key}` : null,
}))

import { emailBranding } from '../email-brand'

const FLAG_ON = JSON.stringify({ portalDesignV2: true })

function publish(edit: (doc: PortalDesign) => void) {
  const doc = defaultDesign()
  edit(doc)
  published.current = { document: doc, number: 3 }
}

describe('emailBranding', () => {
  beforeEach(() => {
    published.current = null
    engine.current = 'auto'
  })

  it('keeps Quackback gold and the workspace logo without a published design', async () => {
    const result = await emailBranding({ logoKey: 'logos/acme.png', featureFlags: FLAG_ON })
    expect(result).toEqual({ brand: undefined, logoUrl: 'https://files.example/logos/acme.png' })
  })

  it('takes the brand colour and the PNG icon from the published design', async () => {
    publish((d) => {
      d.brand.light.accent = '#0c862c'
      d.brand.logo.mark.light = { key: 'design/icon.png' }
    })
    const result = await emailBranding({ logoKey: 'logos/acme.png', featureFlags: FLAG_ON })
    expect(result.brand?.accent).toBe('#0c862c')
    expect(result.logoUrl).toBe('https://files.example/design/icon.png')
  })

  it('falls back to the workspace logo when the icon is an SVG', async () => {
    publish((d) => (d.brand.logo.mark.light = { key: 'design/icon.svg' }))
    const result = await emailBranding({ logoKey: 'logos/acme.png', featureFlags: FLAG_ON })
    expect(result.logoUrl).toBe('https://files.example/logos/acme.png')
  })

  it('never sends an SVG workspace logo', async () => {
    const result = await emailBranding({ logoKey: 'logos/acme.svg', featureFlags: FLAG_ON })
    expect(result.logoUrl).toBeUndefined()
  })

  it('reads flags already resolved by the settings cache', async () => {
    publish((d) => (d.brand.light.accent = '#0c862c'))
    const flags = { portalDesignV2: true } as Parameters<typeof emailBranding>[0]['featureFlags']
    expect((await emailBranding({ logoKey: null, featureFlags: flags })).brand?.accent).toBe(
      '#0c862c'
    )
  })

  it('ignores the design while the portal shows the legacy theme', async () => {
    publish((d) => (d.brand.light.accent = '#0c862c'))
    expect((await emailBranding({ logoKey: null, featureFlags: null })).brand).toBeUndefined()
    engine.current = 'legacy'
    expect((await emailBranding({ logoKey: null, featureFlags: FLAG_ON })).brand).toBeUndefined()
  })
})
