import { describe, expect, it } from 'vitest'
import { externalWidgetOriginHostname, WIDGET_OBSERVATION_THROTTLE_MS } from '../settings.widget'

function request(origin?: string, secFetchSite?: string) {
  // happy-dom enforces the forbidden-header list at construction and silently
  // drops `origin` from init headers; a browser sets the header itself, so set
  // it on the constructed Request (allowed) to emulate a real cross-origin call.
  const req = new Request('https://app.quackback.test/api/widget/config.json')
  if (origin) req.headers.set('origin', origin)
  if (secFetchSite) req.headers.set('sec-fetch-site', secFetchSite)
  return req
}

describe('widget installation observation', () => {
  it('stores a normalized external hostname only', () => {
    expect(externalWidgetOriginHostname(request('https://CUSTOMER.Example:8443'))).toBe(
      'customer.example'
    )
    expect(externalWidgetOriginHostname(request('http://docs.example.'))).toBe('docs.example')
  })

  it.each([
    [undefined, undefined],
    ['null', undefined],
    ['https://app.quackback.test', undefined],
    ['https://customer.example, https://spoof.example', undefined],
    ['file://customer.example', undefined],
    ['https://customer.example/spoofed-path', undefined],
    ['https://customer.example?spoofed=query', undefined],
    ['not a url', undefined],
    ['https://customer.example', 'same-origin'],
  ])('ignores originless, same-origin, opaque, and malformed requests', (origin, site) => {
    expect(externalWidgetOriginHostname(request(origin, site))).toBeNull()
  })

  it('uses the agreed 15-minute write throttle', () => {
    expect(WIDGET_OBSERVATION_THROTTLE_MS).toBe(15 * 60 * 1000)
  })
})
