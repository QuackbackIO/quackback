import { describe, expect, it } from 'vitest'
import { widgetOriginVerifiedLabel } from '../widget-origin'

describe('widget origin evidence copy', () => {
  it('names a public hostname without calling it the customer site', () => {
    expect(widgetOriginVerifiedLabel('docs.example.com')).toBe(
      'First request came from docs.example.com.'
    )
  })

  it('does not present loopback as a site to visit', () => {
    expect(widgetOriginVerifiedLabel('127.0.0.1')).toBe('First request came from a local page.')
    expect(widgetOriginVerifiedLabel(null)).toBe(
      'A request from an external page reached the widget.'
    )
  })
})
