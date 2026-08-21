import { describe, expect, it } from 'vitest'
import { externalWidgetOriginHostname, WIDGET_OBSERVATION_THROTTLE_MS } from '../settings.widget'

function request(
  origin?: string,
  secFetchSite?: string,
  extra?: { referer?: string; host?: string; url?: string }
) {
  // happy-dom enforces the forbidden-header list at construction and silently
  // drops `origin` from init headers; a browser sets the header itself, so set
  // it on the constructed Request (allowed) to emulate a real cross-origin call.
  const req = new Request(extra?.url ?? 'https://app.quackback.test/api/widget/config.json')
  if (origin) req.headers.set('origin', origin)
  if (secFetchSite) req.headers.set('sec-fetch-site', secFetchSite)
  if (extra?.referer) req.headers.set('referer', extra.referer)
  if (extra?.host) req.headers.set('host', extra.host)
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

  it('uses Referer when Origin is absent, ignoring the document path', () => {
    expect(
      externalWidgetOriginHostname(
        request(undefined, undefined, { referer: 'https://docs.example.com/install?ref=1' })
      )
    ).toBe('docs.example.com')
  })

  it('compares against the Host header, not the bind address in request.url', () => {
    expect(
      externalWidgetOriginHostname(
        request('https://docs.example.com', undefined, {
          host: 'app.quackback.test',
          url: 'http://127.0.0.1:3000/api/widget/config.json',
        })
      )
    ).toBe('docs.example.com')
    expect(
      externalWidgetOriginHostname(
        request('http://127.0.0.1:8766', undefined, {
          host: 'app.quackback.test',
          url: 'http://127.0.0.1:3000/api/widget/config.json',
        })
      )
    ).toBe('127.0.0.1')
  })

  it('uses the agreed 15-minute write throttle', () => {
    expect(WIDGET_OBSERVATION_THROTTLE_MS).toBe(15 * 60 * 1000)
  })
})
