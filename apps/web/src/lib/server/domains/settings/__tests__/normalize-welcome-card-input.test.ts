import { describe, it, expect } from 'vitest'
import {
  mergeWelcomeCard,
  normalizeWelcomeCardInput,
  publicWelcomeCard,
  resolveWelcomeCard,
} from '../settings.helpers'
import { DEFAULT_PORTAL_CONFIG, EMPTY_WELCOME_BODY } from '../settings.types'

const richBody = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [{ type: 'text', text: 'Tell us what you think.' }],
    },
  ],
}

describe('resolveWelcomeCard', () => {
  it('returns an empty body when the card is undefined', () => {
    expect(resolveWelcomeCard(undefined)).toEqual({ body: EMPTY_WELCOME_BODY })
  })

  it('folds a legacy enabled title into a leading heading and keeps the body', () => {
    const out = resolveWelcomeCard({
      enabled: true,
      title: 'Share your product feedback!',
      body: richBody,
    })
    expect(out.body.content?.[0]).toEqual({
      type: 'heading',
      attrs: { level: 2 },
      content: [{ type: 'text', text: 'Share your product feedback!' }],
    })
    expect(out.body.content?.[1]).toEqual(richBody.content[0])
    expect(out).not.toHaveProperty('enabled')
    expect(out).not.toHaveProperty('title')
  })

  it('does not prepend a heading when the legacy title is empty or whitespace', () => {
    expect(resolveWelcomeCard({ enabled: true, title: '   ', body: richBody }).body).toEqual(
      richBody
    )
  })

  it('discards disabled drafts — even a stored body becomes empty', () => {
    expect(resolveWelcomeCard({ enabled: false, title: 'Draft', body: richBody })).toEqual({
      body: EMPTY_WELCOME_BODY,
    })
  })

  it('keeps the body as stored when enabled is absent (the new write shape)', () => {
    expect(resolveWelcomeCard({ body: richBody })).toEqual({ body: richBody })
  })
})

describe('normalizeWelcomeCardInput', () => {
  it('returns the input unchanged when undefined', () => {
    expect(normalizeWelcomeCardInput(undefined)).toBeUndefined()
  })

  it('strips disallowed nodes from the body', () => {
    const out = normalizeWelcomeCardInput({
      body: {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'safe' }] },
          // Disallowed node type — must be stripped.
          // oxlint-disable-next-line @typescript-eslint/no-explicit-any
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
      // oxlint-disable-next-line @typescript-eslint/no-explicit-any
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

  it('replaces the body wholesale rather than deep-merging it', () => {
    const existing = {
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
  })

  it('falls back to defaults when there is no existing card', () => {
    const out = mergeWelcomeCard(undefined, { body: richBody })
    expect(out.body).toEqual(richBody)
  })
})

describe('publicWelcomeCard', () => {
  it('returns undefined when the card is undefined', () => {
    expect(publicWelcomeCard(undefined)).toBeUndefined()
  })

  it('returns undefined for a legacy disabled card — never expose drafts', () => {
    expect(publicWelcomeCard({ enabled: false, title: 'draft', body: richBody })).toBeUndefined()
  })

  it('returns undefined when the resolved body is empty', () => {
    expect(publicWelcomeCard({ body: EMPTY_WELCOME_BODY })).toBeUndefined()
  })

  it('returns the resolved card when the body has content', () => {
    expect(publicWelcomeCard({ body: richBody })).toEqual({ body: richBody })
  })

  it('folds a legacy enabled title into the public body', () => {
    const out = publicWelcomeCard({
      enabled: true,
      title: 'Hello',
      body: richBody,
    })
    expect(out?.body.content?.[0]).toMatchObject({
      type: 'heading',
      attrs: { level: 2 },
    })
  })
})
