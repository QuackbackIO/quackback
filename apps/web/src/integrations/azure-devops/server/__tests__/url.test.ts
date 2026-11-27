import { describe, it, expect } from 'vitest'
import { organizationFromUrl } from '@/integrations/azure-devops/server/url'

describe('organizationFromUrl', () => {
  it('reads the organization from a dev.azure.com URL', () => {
    expect(organizationFromUrl('https://dev.azure.com/Contoso')).toBe('Contoso')
    expect(organizationFromUrl('https://dev.azure.com/contoso/Fabrikam/_workitems/edit/1')).toBe(
      'contoso'
    )
  })

  it('reads the organization from a legacy visualstudio.com host', () => {
    expect(organizationFromUrl('https://Contoso.visualstudio.com/')).toBe('contoso')
  })

  it('returns null for other hosts, a missing organization or an invalid URL', () => {
    for (const value of [
      'https://dev.azure.com/',
      'https://example.com/contoso',
      'https://visualstudio.com/',
      'not a url',
      undefined,
      42,
    ]) {
      expect(organizationFromUrl(value)).toBeNull()
    }
  })
})
