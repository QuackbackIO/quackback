import { describe, it, expect } from 'vitest'
import { ValidationError } from '@/lib/shared/errors'
import { normalizeWelcomeCardInput } from '../settings.helpers'

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
