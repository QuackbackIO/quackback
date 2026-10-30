/**
 * Quackback AI's answers reach the draft only through the design's own
 * checks: an unknown value is dropped, an off-schema answer is a refusal, and
 * with no model set up Appearance says so instead of failing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultDesign, portalDesign } from '@/lib/shared/design/schema'
import { resolveDesign } from '@/lib/shared/design/resolve'

const model = vi.hoisted(() => ({
  configured: true,
  answer: null as unknown,
  error: null as unknown,
  calls: [] as Array<{ systemPrompts: string[] }>,
}))

vi.mock('@/lib/server/config', () => ({ config: { openaiApiKey: 'key', openaiBaseUrl: 'url' } }))
vi.mock('@/lib/server/domains/ai/config', () => ({
  isAiClientConfigured: () => model.configured,
}))
vi.mock('@/lib/server/domains/ai/models', () => ({ getChatModel: () => 'test-model' }))
vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({
  enforceAiTokenBudget: async () => {},
}))
vi.mock('@/lib/server/domains/ai/structured-chat', () => ({
  structuredChat: async (input: { systemPrompts: string[] }) => {
    model.calls.push(input)
    if (model.error) throw model.error
    return model.answer
  },
}))

const { askDesignAi, designDirections } = await import('../design-ai')

beforeEach(() => {
  model.configured = true
  model.answer = null
  model.error = null
  model.calls = []
})

describe('askDesignAi', () => {
  it('says so when no AI is set up', async () => {
    model.configured = false
    const result = await askDesignAi({
      message: 'Make it green',
      design: defaultDesign(),
      scope: 'site',
      history: [],
    })
    expect(result).toMatchObject({ ok: false, code: 'AI_UNAVAILABLE' })
  })

  it('applies what fits and drops what does not', async () => {
    model.answer = {
      reply: 'Done.',
      changes: [
        { path: 'brand.light.accent', value: '#0f766e' },
        { path: 'layout.cards', value: 'floating' },
      ],
      outOfScope: false,
    }
    const result = await askDesignAi({
      message: 'Make it green with floating cards',
      design: defaultDesign(),
      scope: 'site',
      history: [],
    })
    expect(result).toMatchObject({ ok: true, reply: 'Done.', skipped: 1 })
    expect(result.ok && result.applied.map((change) => change.path)).toEqual(['brand.light.accent'])
  })

  it('names what the solver adjusted to keep text readable', async () => {
    model.answer = {
      reply: 'Done.',
      changes: [{ path: 'brand.light.accent', value: '#fde047' }],
      outOfScope: false,
    }
    const teal = defaultDesign()
    teal.brand.light.accent = '#0f766e'
    const result = await askDesignAi({
      message: 'Bright yellow',
      design: teal,
      scope: 'site',
      history: [],
    })
    if (!result.ok) throw new Error('expected changes')
    expect(result.applied.map((change) => change.path)).toEqual(['brand.light.accent'])
    expect(result.readability).toEqual(['button text on the accent'])
  })

  it('tells the model which fields the section picked reaches', async () => {
    model.answer = { reply: 'Done.', changes: [], outOfScope: false }
    await askDesignAi({ message: 'Pills', design: defaultDesign(), scope: 'header', history: [] })
    expect(model.calls[0].systemPrompts[0]).toContain(
      'Change only these fields: layout.header, layout.nav'
    )
    expect(model.calls[0].systemPrompts[0]).toContain('the menu style')
  })

  it('says plainly when a request is outside the section, whatever the model wrote', async () => {
    model.answer = {
      reply: 'I added a green band behind the headline.',
      changes: [{ path: 'layout.band', value: 'brand' }],
      outOfScope: false,
    }
    const result = await askDesignAi({
      message: 'A green band behind the headline',
      design: defaultDesign(),
      scope: 'header',
      history: [],
    })
    if (!result.ok) throw new Error('expected an answer')
    expect(result.applied).toEqual([])
    expect(result.outOfScope).toBe(true)
    expect(result.reply).toBe('That is outside the header, so nothing changed.')
  })

  it('keeps the reply when everything asked for is already set', async () => {
    model.answer = {
      reply: 'The header is already stacked.',
      changes: [{ path: 'layout.header', value: 'stacked' }],
      outOfScope: false,
    }
    const result = await askDesignAi({
      message: 'Logo above the menu',
      design: defaultDesign(),
      scope: 'header',
      history: [],
    })
    if (!result.ok) throw new Error('expected an answer')
    expect(result.applied).toEqual([])
    expect(result.reply).toBe('The header is already stacked.')
  })

  it('never claims a change the design refused', async () => {
    model.answer = {
      reply: 'Your cards now float.',
      changes: [{ path: 'layout.cards', value: 'floating' }],
      outOfScope: false,
    }
    const result = await askDesignAi({
      message: 'Floating cards',
      design: defaultDesign(),
      scope: 'site',
      history: [],
    })
    if (!result.ok) throw new Error('expected an answer')
    expect(result.reply).toBe('Nothing changed: the design does not offer that.')
    expect(result.outOfScope).toBe(false)
  })

  it('is a refusal when the answer does not fit the schema', async () => {
    model.error = Object.assign(new Error('bad'), { code: 'structured-output-validation-failed' })
    const result = await askDesignAi({
      message: 'Anything',
      design: defaultDesign(),
      scope: 'site',
      history: [],
    })
    expect(result).toMatchObject({ ok: false, code: 'AI_FAILED' })
  })
})

describe('designDirections', () => {
  it('builds each look on its preset, as a valid and readable design', async () => {
    model.answer = {
      looks: [
        {
          name: 'Calm',
          description: 'Soft.',
          preset: 'calm',
          accent: '#0f766e',
          background: '#f8fafc',
          ink: '#0f172a',
          headingFont: 'nunito',
          bodyFont: 'nunito',
          headline: 'Help us grow',
          subtitle: 'Share ideas and vote.',
        },
        {
          name: 'Editorial',
          description: 'Serif.',
          preset: 'editorial',
          accent: '#b91c1c',
          background: '#fffdf8',
          ink: '#fefefe',
          headingFont: 'fraunces',
          bodyFont: 'inter',
          headline: '',
          subtitle: '',
        },
      ],
    }
    const result = await designDirections({ design: defaultDesign(), site: null, words: 'calm' })
    if (!result.ok) throw new Error('expected looks')
    expect(result.looks.map((look) => look.name)).toEqual(['Calm', 'Editorial'])
    expect(result.looks[0].design.layout.band).toBe('tint')
    expect(result.looks[0].design.brand.light.accent).toBe('#0f766e')
    expect(result.looks[0].preset).toBe('calm')
    expect(result.looks[0].design.pages.feedback.headline).toEqual({
      title: { en: 'Help us grow' },
      subtitle: { en: 'Share ideas and vote.' },
    })
    for (const look of result.looks) {
      const doc = portalDesign.parse(look.design)
      expect(resolveDesign(doc).errors).toEqual([])
    }
    // An unreadable ink is dropped; the preset's stays.
    expect(result.looks[1].design.brand.light.ink).toBe('#1c1917')
  })
})
