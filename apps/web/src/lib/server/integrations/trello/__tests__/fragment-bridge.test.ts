import { describe, expect, it } from 'vitest'
import { trelloFragmentBridgeResponse } from '../fragment-bridge'

describe('trelloFragmentBridgeResponse', () => {
  it('POSTs the fragment token without copying it into the query string', async () => {
    const response = trelloFragmentBridgeResponse()
    const html = await response.text()

    expect(response.status).toBe(200)
    expect(html).toContain("fragment.get('token')")
    expect(html).toContain("form.method = 'post'")
    expect(html).toContain("field.name = token ? 'code' : 'error'")
    expect(html).toContain('window.location.pathname + window.location.search')
    expect(html).not.toContain("searchParams.set('code'")
  })

  it('prevents caching, referrer leakage, and framing', () => {
    const response = trelloFragmentBridgeResponse()

    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('referrer-policy')).toBe('no-referrer')
    expect(response.headers.get('x-content-type-options')).toBe('nosniff')
    expect(response.headers.get('content-security-policy')).toContain("form-action 'self'")
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
  })
})
