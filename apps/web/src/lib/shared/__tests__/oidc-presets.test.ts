import { describe, it, expect } from 'vitest'
import { detectOidcProvider } from '../oidc-presets'

describe('detectOidcProvider', () => {
  it('detects Microsoft Entra ID', () => {
    const p = detectOidcProvider('https://login.microsoftonline.com/abc-def/v2.0')
    expect(p?.id).toBe('entra')
  })
  it('detects Okta', () => {
    const p = detectOidcProvider('https://dev-123.okta.com')
    expect(p?.id).toBe('okta')
  })
  it('detects Google Workspace', () => {
    const p = detectOidcProvider('https://accounts.google.com')
    expect(p?.id).toBe('google-workspace')
  })
  it('detects OneLogin', () => {
    const p = detectOidcProvider('https://acme.onelogin.com/oidc/2')
    expect(p?.id).toBe('onelogin')
  })
  it('returns null for an unknown provider', () => {
    expect(detectOidcProvider('https://auth.example.com')).toBeNull()
  })
  it('returns null for malformed input', () => {
    expect(detectOidcProvider('not a url')).toBeNull()
    expect(detectOidcProvider('')).toBeNull()
    expect(detectOidcProvider(null)).toBeNull()
  })
  it('rejects spoofed subdomain attempts (anchored pattern)', () => {
    expect(detectOidcProvider('https://dev-123.okta.com.attacker.example')).toBeNull()
    expect(detectOidcProvider('https://acme.onelogin.com.attacker.example')).toBeNull()
  })
})
