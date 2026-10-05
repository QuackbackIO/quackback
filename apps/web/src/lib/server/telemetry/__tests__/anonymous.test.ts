import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FEATURE_FLAGS,
  featureFlagsForUseCase,
} from '@/lib/server/domains/settings/settings.types'
import {
  aiFeatureOf,
  aiProviderOf,
  assertAnonymousTelemetry,
  authMethodsOf,
  knownValues,
  productsFromFlags,
  toAgeBracket,
  toScaleBracket,
} from '../anonymous'

describe('toScaleBracket', () => {
  it('buckets counts into bands, never exact values', () => {
    expect(toScaleBracket(0)).toBe('0')
    expect(toScaleBracket(1)).toBe('1-10')
    expect(toScaleBracket(10)).toBe('1-10')
    expect(toScaleBracket(11)).toBe('11-50')
    expect(toScaleBracket(200)).toBe('51-200')
    expect(toScaleBracket(201)).toBe('201-1000')
    expect(toScaleBracket(1000)).toBe('201-1000')
    expect(toScaleBracket(1001)).toBe('1001-10000')
    expect(toScaleBracket(10_001)).toBe('10000+')
  })

  it('treats a missing or negative count as zero', () => {
    expect(toScaleBracket(-3)).toBe('0')
    expect(toScaleBracket(Number.NaN)).toBe('0')
  })
})

describe('toAgeBracket', () => {
  const day = 86_400_000
  const now = new Date('2026-06-01T00:00:00Z')
  const ago = (days: number) => new Date(now.getTime() - days * day)

  it('bands the install age', () => {
    expect(toAgeBracket(ago(0), now)).toBe('<7d')
    expect(toAgeBracket(ago(6.9), now)).toBe('<7d')
    expect(toAgeBracket(ago(7), now)).toBe('7-30d')
    expect(toAgeBracket(ago(31), now)).toBe('31-90d')
    expect(toAgeBracket(ago(200), now)).toBe('91-365d')
    expect(toAgeBracket(ago(400), now)).toBe('365d+')
  })

  it('is null without a creation date', () => {
    expect(toAgeBracket(null, now)).toBeNull()
  })
})

describe('aiProviderOf', () => {
  it('is none without an API key', () => {
    expect(aiProviderOf(undefined, 'https://openrouter.ai/api/v1')).toBe('none')
  })

  it('names the provider from the base URL host, never the URL itself', () => {
    expect(aiProviderOf('k', undefined)).toBe('openai')
    expect(aiProviderOf('k', 'https://api.openai.com/v1')).toBe('openai')
    expect(aiProviderOf('k', 'https://openrouter.ai/api/v1')).toBe('openrouter')
    expect(aiProviderOf('k', 'https://acme.openai.azure.com/openai')).toBe('azure')
    expect(aiProviderOf('k', 'https://generativelanguage.googleapis.com/v1beta/openai')).toBe(
      'google'
    )
    expect(aiProviderOf('k', 'http://localhost:11434/v1')).toBe('local')
    expect(aiProviderOf('k', 'http://host.docker.internal:11434/v1')).toBe('local')
    expect(aiProviderOf('k', 'http://192.168.1.20:8080/v1')).toBe('local')
    expect(aiProviderOf('k', 'https://llm.internal.example/v1')).toBe('other')
    expect(aiProviderOf('k', 'not a url')).toBe('other')
  })

  it('matches a provider domain only on a label boundary', () => {
    expect(aiProviderOf('k', 'https://evilgoogleapis.com/v1')).toBe('other')
    expect(aiProviderOf('k', 'https://notopenrouter.ai/v1')).toBe('other')
    expect(aiProviderOf('k', 'https://myazure.com/v1')).toBe('other')
  })
})

describe('aiFeatureOf', () => {
  it('groups pipeline steps into the feature a person would name', () => {
    expect(aiFeatureOf('assistant')).toBe('assistant')
    expect(aiFeatureOf('assistant_posts_query')).toBe('assistant')
    expect(aiFeatureOf('copilot_suggest')).toBe('copilot')
    expect(aiFeatureOf('help_center_answers')).toBe('helpCenter')
    expect(aiFeatureOf('kb_search_query_embedding')).toBe('helpCenter')
    expect(aiFeatureOf('extraction')).toBe('feedback')
    expect(aiFeatureOf('quality_gate')).toBe('feedback')
    expect(aiFeatureOf('post_autotag')).toBe('feedback')
    expect(aiFeatureOf('conversation_summary')).toBe('inbox')
    expect(aiFeatureOf('spam_classification')).toBe('inbox')
    expect(aiFeatureOf('something_new')).toBe('other')
  })
})

describe('authMethodsOf', () => {
  it('keeps known provider ids and reports any custom identity provider as oidc', () => {
    expect(authMethodsOf(['google', 'github', 'acme-okta', 'sso'], ['google', 'github'])).toEqual([
      'github',
      'google',
      'oidc',
    ])
  })
})

describe('knownValues', () => {
  it('drops anything outside the allowlist, dedupes and sorts', () => {
    expect(
      knownValues(['slack', 'my-private-thing', 'linear', 'slack'], ['linear', 'slack'])
    ).toEqual(['linear', 'slack'])
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
