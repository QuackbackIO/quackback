import { describe, expect, it } from 'vitest'
import { externalWidgetOriginHostname, WIDGET_OBSERVATION_THROTTLE_MS } from '../settings.widget'

function request(origin?: string, secFetchSite?: string) {
  const headers = new Headers()
  if (origin) headers.set('origin', origin)
  if (secFetchSite) headers.set('sec-fetch-site', secFetchSite)
  return new Request('https://app.quackback.test/api/widget/config.json', { headers })
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
