import { describe, it, expect } from 'vitest'
import { ValidationError } from '@/lib/shared/errors'
import { mergeWelcomeCard, normalizeWelcomeCardInput, publicWelcomeCard } from '../settings.helpers'
import { DEFAULT_PORTAL_CONFIG } from '../settings.types'

describe('normalizeWelcomeCardInput', () => {
  it('returns the input unchanged when undefined', () => {
    expect(normalizeWelcomeCardInput(undefined)).toBeUndefined()
  })

  it('passes through enabled with no validation', () => {
    const out = normalizeWelcomeCardInput({ enabled: true })
    expect(out).toEqual({ enabled: true })
  })

  it('trims the title', () => {
    const out = normalizeWelcomeCardInput({ title: '  Hello  ' })
    expect(out?.title).toBe('Hello')
  })

  it('rejects a title longer than 120 chars', () => {
    expect(() => normalizeWelcomeCardInput({ title: 'a'.repeat(121) })).toThrow(ValidationError)
  })

  it('accepts a title of exactly 120 chars', () => {
    const out = normalizeWelcomeCardInput({ title: 'a'.repeat(120) })
    expect(out?.title?.length).toBe(120)
  })

  it('strips disallowed nodes from the body', () => {
    const out = normalizeWelcomeCardInput({
      body: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'safe' }] },
          // Disallowed node type — must be stripped.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { type: 'rogueNode', attrs: { evil: 'true' } } as any,
        ],
      },
    })
    const body = out?.body
    expect(body?.type).toBe('doc')
    const types = body?.content?.map((c) => c.type) ?? []
    expect(types).not.toContain('rogueNode')
    expect(types).toContain('paragraph')
  })

  it('returns an empty doc when body sanitizes to nothing usable', () => {
    const out = normalizeWelcomeCardInput({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      body: { type: 'notDoc' } as any,
    })
    expect(out?.body).toEqual({ type: 'doc' })
  })
})

describe('mergeWelcomeCard', () => {
  const seed = DEFAULT_PORTAL_CONFIG.welcomeCard!

  it('returns existing when partial is undefined', () => {
    expect(mergeWelcomeCard(seed, undefined)).toBe(seed)
  })

  it('overrides scalar fields shallowly', () => {
    const out = mergeWelcomeCard(seed, { enabled: true, title: 'Hi' })
    expect(out.enabled).toBe(true)
    expect(out.title).toBe('Hi')
    expect(out.body).toEqual(seed.body)
  })

  it('replaces the body wholesale rather than deep-merging it', () => {
    const existing = {
      enabled: true,
      title: 'Old',
      body: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'old text' }],
          },
        ],
      },
    }
    const out = mergeWelcomeCard(existing, { body: { type: 'doc' } })
    expect(out.body).toEqual({ type: 'doc' })
    expect(out.body.content).toBeUndefined()
    expect(out.title).toBe('Old')
  })

  it('falls back to defaults when there is no existing card', () => {
    const out = mergeWelcomeCard(undefined, { enabled: true })
    expect(out.enabled).toBe(true)
    expect(out.title).toBe(seed.title)
    expect(out.body).toEqual(seed.body)
  })
})

describe('publicWelcomeCard', () => {
  it('returns undefined when the card is undefined', () => {
    expect(publicWelcomeCard(undefined)).toBeUndefined()
  })

  it('returns undefined when the card is disabled — never expose drafts', () => {
    expect(
      publicWelcomeCard({ enabled: false, title: 'draft', body: { type: 'doc' } })
    ).toBeUndefined()
  })

  it('returns the card verbatim when enabled', () => {
    const card = { enabled: true, title: 'Hi', body: { type: 'doc' } }
    expect(publicWelcomeCard(card)).toEqual(card)
  })
})
