import { describe, it, expect } from 'vitest'
import { checkAddress } from '../install-checks'

describe('checkAddress', () => {
  it('passes when the browser uses the BASE_URL host', () => {
    expect(checkAddress('https://feedback.example.com', 'feedback.example.com', 'https')).toEqual({
      ok: true,
      baseUrl: 'https://feedback.example.com',
      visitedOrigin: null,
    })
  })

  // A proxy that terminates TLS forwards plain http; BASE_URL is still right.
  it('ignores the protocol behind a TLS-terminating proxy', () => {
    expect(checkAddress('https://feedback.example.com', 'feedback.example.com', 'http').ok).toBe(
      true
    )
  })

  it('treats a default port as the same host', () => {
    expect(
      checkAddress('https://feedback.example.com', 'feedback.example.com:443', 'https').ok
    ).toBe(true)
  })

  it('flags a BASE_URL that names another host, and says which one was visited', () => {
    expect(checkAddress('http://localhost:3000', '192.168.1.20:3000', 'http')).toEqual({
      ok: false,
      baseUrl: 'http://localhost:3000',
      visitedOrigin: 'http://192.168.1.20:3000',
    })
  })

  it('flags a different port on the same host', () => {
    expect(checkAddress('http://localhost:3000', 'localhost:3110', 'http').ok).toBe(false)
  })

  it('reads the first value of a forwarded header list', () => {
    expect(
      checkAddress(
        'https://feedback.example.com',
        'feedback.example.com, proxy.internal',
        'https, http'
      ).ok
    ).toBe(true)
  })

  it('passes when the request names no host, rather than guessing', () => {
    expect(checkAddress('https://feedback.example.com', null, null).ok).toBe(true)
  })

  it('fails on a BASE_URL that is not a URL', () => {
    expect(checkAddress('not a url', 'feedback.example.com', 'https').ok).toBe(false)
  })
})
