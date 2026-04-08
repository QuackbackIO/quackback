import { describe, it, expect } from 'vitest'
import { parseJsonConfig } from '../settings.helpers'

// These imports will fail until we implement the types
import {
  DEFAULT_HELP_CENTER_CONFIG,
  DEFAULT_HELP_CENTER_SEO_CONFIG,
  type HelpCenterConfig,
  type HelpCenterSeoConfig,
} from '../settings.types'

describe('HelpCenterSeoConfig', () => {
  describe('DEFAULT_HELP_CENTER_SEO_CONFIG', () => {
    it('should have empty metaDescription', () => {
      expect(DEFAULT_HELP_CENTER_SEO_CONFIG.metaDescription).toBe('')
    })

    it('should have sitemapEnabled true by default', () => {
      expect(DEFAULT_HELP_CENTER_SEO_CONFIG.sitemapEnabled).toBe(true)
    })

    it('should have structuredDataEnabled true by default', () => {
      expect(DEFAULT_HELP_CENTER_SEO_CONFIG.structuredDataEnabled).toBe(true)
    })

    it('should have ogImageKey null by default', () => {
      expect(DEFAULT_HELP_CENTER_SEO_CONFIG.ogImageKey).toBeNull()
    })
  })

  describe('type constraints', () => {
    it('should accept a full SEO config', () => {
      const config: HelpCenterSeoConfig = {
        metaDescription: 'Our help center',
        sitemapEnabled: false,
        structuredDataEnabled: false,
        ogImageKey: 'uploads/og-image.png',
      }
      expect(config.metaDescription).toBe('Our help center')
      expect(config.ogImageKey).toBe('uploads/og-image.png')
    })
  })
})

describe('HelpCenterConfig', () => {
  describe('DEFAULT_HELP_CENTER_CONFIG', () => {
    it('should have enabled set to false', () => {
      expect(DEFAULT_HELP_CENTER_CONFIG.enabled).toBe(false)
    })

    it('should have subdomain null', () => {
      expect(DEFAULT_HELP_CENTER_CONFIG.subdomain).toBeNull()
    })

    it('should have customDomain null', () => {
      expect(DEFAULT_HELP_CENTER_CONFIG.customDomain).toBeNull()
    })

    it('should have domainVerified false', () => {
      expect(DEFAULT_HELP_CENTER_CONFIG.domainVerified).toBe(false)
    })

    it('should have default homepage title', () => {
      expect(DEFAULT_HELP_CENTER_CONFIG.homepageTitle).toBe('How can we help?')
    })

    it('should have default homepage description', () => {
      expect(DEFAULT_HELP_CENTER_CONFIG.homepageDescription).toBe(
        'Search our knowledge base or browse by category'
      )
    })

    it('should have access set to public', () => {
      expect(DEFAULT_HELP_CENTER_CONFIG.access).toBe('public')
    })

    it('should have default SEO config embedded', () => {
      expect(DEFAULT_HELP_CENTER_CONFIG.seo).toEqual(DEFAULT_HELP_CENTER_SEO_CONFIG)
    })
  })

  describe('type constraints', () => {
    it('should accept a full config', () => {
      const config: HelpCenterConfig = {
        enabled: true,
        subdomain: 'help',
        customDomain: 'help.example.com',
        domainVerified: true,
        homepageTitle: 'Get Help',
        homepageDescription: 'Browse our docs',
        access: 'authenticated',
        seo: {
          metaDescription: 'Help center',
          sitemapEnabled: true,
          structuredDataEnabled: true,
          ogImageKey: null,
        },
      }
      expect(config.enabled).toBe(true)
      expect(config.access).toBe('authenticated')
    })

    it('should accept public access', () => {
      const config: HelpCenterConfig = {
        ...DEFAULT_HELP_CENTER_CONFIG,
        access: 'public',
      }
      expect(config.access).toBe('public')
    })
  })
})

describe('parseJsonConfig with HelpCenterConfig', () => {
  it('returns default when json is null', () => {
    const result = parseJsonConfig(null, DEFAULT_HELP_CENTER_CONFIG)
    expect(result).toEqual(DEFAULT_HELP_CENTER_CONFIG)
  })

  it('returns default when json is invalid', () => {
    const result = parseJsonConfig('not valid json', DEFAULT_HELP_CENTER_CONFIG)
    expect(result).toEqual(DEFAULT_HELP_CENTER_CONFIG)
  })

  it('deep merges partial config with defaults', () => {
    const stored = JSON.stringify({
      enabled: true,
      homepageTitle: 'Custom Title',
    })

    const result = parseJsonConfig(stored, DEFAULT_HELP_CENTER_CONFIG)

    expect(result.enabled).toBe(true)
    expect(result.homepageTitle).toBe('Custom Title')
    // Defaults should be preserved
    expect(result.subdomain).toBeNull()
    expect(result.customDomain).toBeNull()
    expect(result.domainVerified).toBe(false)
    expect(result.homepageDescription).toBe('Search our knowledge base or browse by category')
    expect(result.access).toBe('public')
    expect(result.seo).toEqual(DEFAULT_HELP_CENTER_SEO_CONFIG)
  })

  it('deep merges nested seo config with defaults', () => {
    const stored = JSON.stringify({
      enabled: true,
      seo: {
        metaDescription: 'Custom meta',
        sitemapEnabled: false,
      },
    })

    const result = parseJsonConfig(stored, DEFAULT_HELP_CENTER_CONFIG)

    expect(result.enabled).toBe(true)
    expect(result.seo.metaDescription).toBe('Custom meta')
    expect(result.seo.sitemapEnabled).toBe(false)
    // Preserved from defaults
    expect(result.seo.structuredDataEnabled).toBe(true)
    expect(result.seo.ogImageKey).toBeNull()
  })

  it('preserves access value from stored config', () => {
    const stored = JSON.stringify({
      access: 'authenticated',
    })

    const result = parseJsonConfig(stored, DEFAULT_HELP_CENTER_CONFIG)
    expect(result.access).toBe('authenticated')
    // Rest from defaults
    expect(result.enabled).toBe(false)
  })
})
