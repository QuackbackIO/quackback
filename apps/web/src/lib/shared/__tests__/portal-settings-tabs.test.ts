import { describe, expect, it } from 'vitest'
import { PERMISSIONS } from '../permissions'
import {
  CUSTOM_DOMAINS_HREF,
  CUSTOM_DOMAINS_LINK,
  legacyCustomDomainsTarget,
  portalTabsFor,
  resolvePortalTab,
} from '../portal-settings-tabs'

const BRANDING = PERMISSIONS.SETTINGS_BRANDING
const CUSTOM_DOMAIN = PERMISSIONS.SETTINGS_CUSTOM_DOMAIN

describe('portal settings tabs', () => {
  it('offers Navigation to settings.branding and Custom domains to settings.custom_domain', () => {
    expect(portalTabsFor([BRANDING, CUSTOM_DOMAIN])).toEqual(['navigation', 'custom-domains'])
    expect(portalTabsFor([BRANDING])).toEqual(['navigation'])
    expect(portalTabsFor([CUSTOM_DOMAIN])).toEqual(['custom-domains'])
    expect(portalTabsFor([])).toEqual([])
    expect(portalTabsFor(undefined)).toEqual([])
  })

  it('opens the tab asked for when the viewer has it, otherwise their first tab', () => {
    const both = portalTabsFor([BRANDING, CUSTOM_DOMAIN])
    expect(resolvePortalTab(undefined, both)).toBe('navigation')
    expect(resolvePortalTab('custom-domains', both)).toBe('custom-domains')
    // Without settings.custom_domain the tab is not there to open.
    expect(resolvePortalTab('custom-domains', portalTabsFor([BRANDING]))).toBe('navigation')
    expect(resolvePortalTab(undefined, portalTabsFor([CUSTOM_DOMAIN]))).toBe('custom-domains')
    expect(resolvePortalTab('navigation', portalTabsFor([CUSTOM_DOMAIN]))).toBe('custom-domains')
  })

  it('links to the Custom domains tab of Settings > Portal', () => {
    expect(CUSTOM_DOMAINS_LINK).toEqual({
      to: '/admin/settings/portal',
      search: { tab: 'custom-domains' },
    })
    expect(CUSTOM_DOMAINS_HREF).toBe('/admin/settings/portal?tab=custom-domains')
  })

  it('sends the old Domains anchor to the tab, for a viewer who can open it', () => {
    expect(legacyCustomDomainsTarget('#custom-domains', [CUSTOM_DOMAIN])).toEqual(
      CUSTOM_DOMAINS_LINK
    )
    expect(legacyCustomDomainsTarget('#custom-domains', [BRANDING])).toBeNull()
    expect(legacyCustomDomainsTarget('#domain-verification', [CUSTOM_DOMAIN])).toBeNull()
    expect(legacyCustomDomainsTarget('', [CUSTOM_DOMAIN])).toBeNull()
  })
})
