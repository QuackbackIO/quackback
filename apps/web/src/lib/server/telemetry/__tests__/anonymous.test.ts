import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FEATURE_FLAGS,
  featureFlagsForUseCase,
} from '@/lib/server/domains/settings/settings.types'
import { assertAnonymousTelemetry, productsFromFlags, toScaleBracket } from '../anonymous'

describe('toScaleBracket', () => {
  it('buckets counts the same way the worker accepts', () => {
    expect(toScaleBracket(0)).toBe('0')
    expect(toScaleBracket(1)).toBe('1-10')
    expect(toScaleBracket(10)).toBe('1-10')
    expect(toScaleBracket(11)).toBe('11-50')
    expect(toScaleBracket(200)).toBe('51-200')
    expect(toScaleBracket(201)).toBe('200+')
  })
})

describe('productsFromFlags', () => {
  it('reports only the five products, with Help Center as a product not Labs', () => {
    expect(productsFromFlags(DEFAULT_FEATURE_FLAGS)).toEqual({
      feedback: true,
      support: false,
      helpCenter: false,
      changelog: true,
      status: false,
    })
    expect(productsFromFlags(featureFlagsForUseCase('help_center')).helpCenter).toBe(true)
  })
})

describe('assertAnonymousTelemetry', () => {
  const clean = {
    version: '0.13.2',
    instanceId: '11111111-1111-4111-8111-111111111111',
    products: { feedback: true, support: false, helpCenter: false, changelog: true, status: false },
    cloud: false,
    firstWin: { reached: false, outcome: 'internal' },
    widgetInstalled: false,
    activation: { outcome: 'internal', starterResolution: 'created' },
    seats7d: '1-10',
    scale: { users: '1-10', posts: '0', boards: '1-10' },
  }

  it('accepts the phone-home shape', () => {
    expect(() => assertAnonymousTelemetry(clean)).not.toThrow()
  })

  it.each(['email', 'url', 'token', 'content', 'hostname', 'origin'])(
    'rejects a %s field at any depth',
    (key) => {
      expect(() => assertAnonymousTelemetry({ ...clean, [key]: 'x' })).toThrow(/forbidden/i)
      expect(() => assertAnonymousTelemetry({ ...clean, nested: { [key]: 'x' } })).toThrow(
        /forbidden/i
      )
    }
  )

  it('rejects emails and URLs in string values', () => {
    expect(() => assertAnonymousTelemetry({ ...clean, version: 'ops@example.com' })).toThrow(
      /email/i
    )
    expect(() => assertAnonymousTelemetry({ ...clean, deployMethod: 'https://evil.test' })).toThrow(
      /url/i
    )
  })

  it('does not treat a semver as a URL', () => {
    expect(() => assertAnonymousTelemetry({ ...clean, version: '0.13.2' })).not.toThrow()
  })
})
