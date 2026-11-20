import { describe, expect, it } from 'vitest'
import { isE2eOidcFakeUrl } from '../oidc-fake'

const ENV = {
  E2E_HARNESS: '1',
  BASE_URL: 'http://acme.localhost:3000',
  E2E_OIDC_FAKE_HOST: 'oidc-fake.localhost:4014',
}
const FAKE = 'https://oidc-fake.localhost:4014/abc/.well-known/openid-configuration'

describe('isE2eOidcFakeUrl', () => {
  it('accepts exactly the configured https host and port behind the gate', () => {
    expect(isE2eOidcFakeUrl(FAKE, ENV)).toBe(true)
    expect(isE2eOidcFakeUrl('https://OIDC-FAKE.localhost:4014/token', ENV)).toBe(true)
  })

  it('is refused without the harness flag', () => {
    expect(isE2eOidcFakeUrl(FAKE, { ...ENV, E2E_HARNESS: undefined })).toBe(false)
  })

  it('is refused with the flag on a public BASE_URL', () => {
    expect(isE2eOidcFakeUrl(FAKE, { ...ENV, BASE_URL: 'https://feedback.example.com' })).toBe(false)
  })

  it('is refused on the pooled fleet', () => {
    expect(isE2eOidcFakeUrl(FAKE, { ...ENV, QUACKBACK_TENANCY: 'pooled' })).toBe(false)
  })

  it('is refused when no fake is configured', () => {
    expect(isE2eOidcFakeUrl(FAKE, { ...ENV, E2E_OIDC_FAKE_HOST: undefined })).toBe(false)
  })

  it('refuses http, another port, another host and look-alikes', () => {
    for (const url of [
      'http://oidc-fake.localhost:4014/',
      'https://oidc-fake.localhost:4015/',
      'https://oidc-fake.localhost/',
      'https://other.localhost:4014/',
      'https://oidc-fake.localhost.evil.com:4014/',
      'https://127.0.0.1:4014/',
    ]) {
      expect(isE2eOidcFakeUrl(url, ENV), url).toBe(false)
    }
  })

  it('refuses a configured fake carrying userinfo or a path', () => {
    for (const host of ['x.localhost:1@10.0.0.5', 'oidc-fake.localhost:4014/p']) {
      const env = { ...ENV, E2E_OIDC_FAKE_HOST: host }
      for (const url of [
        `https://${host}/`,
        'https://10.0.0.5/',
        'https://x.localhost:1/',
        'https://oidc-fake.localhost:4014/p',
        FAKE,
      ]) {
        expect(isE2eOidcFakeUrl(url, env), `${host} ${url}`).toBe(false)
      }
    }
  })

  it('refuses a configured fake that is not a loopback name', () => {
    for (const host of ['10.0.0.5:4014', '127.0.0.1:4014', 'idp.example.com:443', '[::1]:4014']) {
      const env = { ...ENV, E2E_OIDC_FAKE_HOST: host }
      expect(isE2eOidcFakeUrl(`https://${host}/`, env), host).toBe(false)
    }
  })
})
