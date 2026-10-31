/**
 * Quackback AI's answers reach the draft only through the design's own
 * checks: an unknown value is dropped, an off-schema answer is a refusal, and
 * with no model set up Appearance says so instead of failing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultDesign, portalDesign } from '@/lib/shared/design/schema'
import { resolveDesign } from '@/lib/shared/design/resolve'
import { DESIGN_PRESETS } from '@/lib/shared/design/presets'
import type { HomeBlockType } from '@/lib/shared/design/home'

const model = vi.hoisted(() => ({
  configured: true,
  answer: null as unknown,
  error: null as unknown,
  calls: [] as Array<{ systemPrompts: string[]; messages: Array<{ content: unknown }> }>,
  refusesImages: false,
  /** Answers that do not fit the schema before one that does. */
  misfits: 0,
  /** A complete look; a test's look names only what it is about. */
  fullLook: {} as Record<string, unknown>,
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
  structuredChat: async (input: {
    systemPrompts: string[]
    messages: Array<{ content: unknown }>
  }) => {
    model.calls.push(input)
    if (model.error) throw model.error
    if (model.misfits > 0) {
      model.misfits--
      throw Object.assign(new Error('did not fit'), { code: 'structured-output-validation-failed' })
    }
    if (model.refusesImages && Array.isArray(input.messages[0]?.content))
      throw new Error('this model does not take images')
    const answer = model.answer as { looks?: Array<Record<string, unknown>> } | null
    if (answer?.looks)
      return { looks: answer.looks.map((look) => ({ ...model.fullLook, homeBlocks: [], ...look })) }
    return model.answer
  },
}))

const { askDesignAi, designDirections, EDIT_EXAMPLES, parseValue } = await import('../design-ai')
const { DIRECTIONS_EXAMPLE } = await import('../design-directions')
model.fullLook = DIRECTIONS_EXAMPLE
const { applyDesignChanges } = await import('@/lib/shared/design/apply-changes')

const EVERY_BLOCK = [
  'welcome',
  'composer',
  'ideas',
  'roadmap',
  'updates',
  'help_search',
  'help_topics',
  'status',
  'contact',
  'links',
] as const
const ALLOWS: {
  blockTypes: readonly HomeBlockType[]
  writesCss: boolean
  checkCss: (css: string) => string | null
} = { blockTypes: EVERY_BLOCK, writesCss: false, checkCss: () => 'Quackback AI does not write CSS' }

beforeEach(() => {
  model.misfits = 0
  model.refusesImages = false
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
      allows: ALLOWS,
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
      allows: ALLOWS,
    })
    // What was left alone is named with why, so the reply never overclaims.
    expect(result).toMatchObject({
      ok: true,
      reply: 'Done. Left alone: Cards: it takes bordered, raised, list.',
      skipped: 1,
    })
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
      allows: ALLOWS,
    })
    if (!result.ok) throw new Error('expected changes')
    expect(result.applied.map((change) => change.path)).toEqual(['brand.light.accent'])
    expect(result.readability).toEqual(['button text on the accent'])
  })

  it('tells the model which fields the section picked reaches', async () => {
    model.answer = { reply: 'Done.', changes: [], outOfScope: false }
    await askDesignAi({
      message: 'Pills',
      design: defaultDesign(),
      scope: 'header',
      history: [],
      allows: ALLOWS,
    })
    expect(model.calls[0].systemPrompts[0]).toContain(
      'Change only these fields and what is under them: layout.header, layout.nav, layout.headerOnBand, nav, brand.logo'
    )
    expect(model.calls[0].systemPrompts[0]).toContain('how the menu marks the current page')
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
      allows: ALLOWS,
    })
    if (!result.ok) throw new Error('expected an answer')
    expect(result.applied).toEqual([])
    expect(result.outOfScope).toBe(true)
    expect(result.reply).toBe('That is outside the header, so nothing changed.')
  })

  it('passes the colours of an attached image with the request', async () => {
    model.answer = { reply: 'Done.', changes: [], outOfScope: false }
    await askDesignAi({
      message: 'Use these colours',
      design: defaultDesign(),
      scope: 'site',
      history: [],
      allows: ALLOWS,
      palette: ['#7a1f35', '#ffffff'],
    })
    const sent = model.calls[0] as unknown as { messages: Array<{ content: string }> }
    expect(sent.messages.at(-1)!.content).toBe(
      'Use these colours\n\nColours from the attached image: #7a1f35, #ffffff. The brand colour, the most used colour that is not a neutral: #7a1f35.'
    )
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
      allows: ALLOWS,
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
      allows: ALLOWS,
    })
    if (!result.ok) throw new Error('expected an answer')
    expect(result.reply).toBe('Nothing changed (Cards: it takes bordered, raised, list).')
    expect(result.outOfScope).toBe(false)
  })

  it('is a refusal when the answer does not fit the schema', async () => {
    model.error = Object.assign(new Error('bad'), { code: 'structured-output-validation-failed' })
    const result = await askDesignAi({
      message: 'Anything',
      design: defaultDesign(),
      scope: 'site',
      history: [],
      allows: ALLOWS,
    })
    expect(result).toMatchObject({ ok: false, code: 'AI_FAILED' })
  })
})

describe('designDirections', () => {
  it('keeps the page quiet when a look paints it in the brand colour', async () => {
    model.answer = {
      looks: [
        {
          name: 'Gold',
          description: 'Bright.',
          preset: 'calm',
          accent: '#c2410c',
          background: '#f5b301',
          ink: '#1c1408',
          headingFont: 'inter',
          bodyFont: 'inter',
          headline: 'Ideas',
          subtitle: '',
        },
      ],
    }
    const result = await designDirections({
      allows: ALLOWS,
      design: defaultDesign(),
      site: null,
      words: 'gold',
    })
    if (!result.ok) throw new Error('expected looks')
    const calm = DESIGN_PRESETS.find((preset) => preset.id === 'calm')!
    expect(result.looks[0].design.brand.light.background).toBe(calm.look.brand.light.background)
    expect(result.looks[0].design.brand.light.accent).toBe('#c2410c')
  })

  it('builds each look on its preset, as a valid and readable design', async () => {
    model.answer = {
      looks: [
        {
          name: 'Calm',
          description: 'Soft.',
          preset: 'calm',
          band: 'tint',
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
    const result = await designDirections({
      allows: ALLOWS,
      design: defaultDesign(),
      site: null,
      words: 'calm',
      palette: ['#0f766e', '#f8fafc'],
    })
    const brief = (model.calls[0] as unknown as { messages: Array<{ content: string }> })
      .messages[0].content
    expect(brief).toContain(
      'Colours from their logo or a screenshot: #0f766e, #f8fafc. The brand colour, the most used colour that is not a neutral: #0f766e. Use the brand colour as the accent in the first look, as it is.'
    )
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

describe('any change to the design', () => {
  const ask = (
    changes: Array<{ path: string; value: string }>,
    message = 'Do it',
    allows = ALLOWS
  ) => {
    model.answer = { reply: 'Done.', outOfScope: false, changes }
    return askDesignAi({ message, design: defaultDesign(), scope: 'site', history: [], allows })
  }

  it('keeps every example it shows the model valid', () => {
    for (const example of EDIT_EXAMPLES) {
      const result = applyDesignChanges(
        defaultDesign(),
        example.answer.changes.map((change) => ({
          path: change.path,
          value: parseValue(change.value),
        })),
        'site',
        { ...ALLOWS, links: new Set() }
      )
      expect(result.refused, example.request).toEqual([])
      expect(result.applied).toHaveLength(example.answer.changes.length)
    }
  })

  it('builds Home from blocks written by type and width', async () => {
    const result = await ask([
      { path: 'nav.home.on', value: 'true' },
      {
        path: 'pages.home.blocks',
        value:
          '[{"type":"welcome","width":"full","body":"Hello there."},{"type":"composer","width":"two_thirds"},{"type":"status","width":"third"},{"type":"ideas","width":"half"}]',
      },
    ])
    if (!result.ok) throw new Error(result.message)
    expect(result.design.nav.home.on).toBe(true)
    expect(result.design.pages.home.blocks.map((block) => `${block.type} ${block.width}`)).toEqual([
      'welcome full',
      'composer two_thirds',
      'status third',
      'ideas half',
    ])
    expect(result.design.pages.home.blocks[3]).toMatchObject({ sort: 'trending', count: 3 })
  })

  it('names the words, the menu and own wording in any language', async () => {
    const result = await ask([
      { path: 'vocabulary.post', value: '"suggestion"' },
      {
        path: 'pages.feedback.copy.prompt',
        value: '{"en":"Pitch an idea","de":"Schlag etwas vor"}',
      },
      { path: 'nav.items.2.shown', value: 'false' },
    ])
    if (!result.ok) throw new Error(result.message)
    expect(result.design.vocabulary.post).toBe('suggestion')
    expect(result.design.pages.feedback.copy.prompt).toEqual({
      en: 'Pitch an idea',
      de: 'Schlag etwas vor',
    })
    expect(result.design.nav.items[2]).toMatchObject({ type: 'changelog', shown: false })
  })

  it('takes no link, file or Home block the workspace did not give it, and says why', async () => {
    const result = await ask(
      [
        {
          path: 'pages.home.blocks',
          value:
            '[{"type":"links","width":"third","links":[{"label":"Shop","url":"https://shop.example.com"}]}]',
        },
        { path: 'brand.logo.mark.light', value: '{"key":"logos/2026/10/someone-else.png"}' },
        { path: 'pages.home.blocks', value: '[{"type":"status","width":"third"}]' },
      ],
      'Add our docs, https://docs.example.com',
      { ...ALLOWS, blockTypes: ['welcome', 'links', 'composer'] }
    )
    if (!result.ok) throw new Error(result.message)
    expect(result.applied).toEqual([])
    expect(result.reply).toContain('https://shop.example.com is not a link you gave')
    expect(result.reply).toContain('images and fonts are uploaded in Brand')
    expect(result.reply).toContain('the status block needs its page on')

    const given = await ask(
      [
        {
          path: 'pages.home.blocks',
          value:
            '[{"type":"links","width":"third","links":[{"label":"Docs","url":"https://docs.example.com"}]}]',
        },
      ],
      'Add our docs, https://docs.example.com'
    )
    expect(given.ok && given.applied.map((change) => change.path)).toEqual(['pages.home.blocks'])
  })

  it('writes CSS only where the workspace lets it, and only CSS the check passes', async () => {
    const off = await ask([
      { path: 'css', value: '"[data-qb-part=\\"post-card\\"] { border-width: 2px; }"' },
    ])
    expect(off.ok && off.applied).toEqual([])
    expect(off.ok && off.reply).toContain('Quackback AI does not write CSS')
    expect(model.calls.at(-1)!.systemPrompts[0]).not.toContain('data-qb-part')

    const on = {
      ...ALLOWS,
      writesCss: true,
      checkCss: (css: string) => (css.includes('@import') ? 'no @import' : null),
    }
    const written = await ask(
      [{ path: 'css', value: '"[data-qb-part=\\"post-card\\"] { border-width: 2px; }"' }],
      'Do it',
      on
    )
    expect(written.ok && written.design.css).toBe(
      '[data-qb-part="post-card"] { border-width: 2px; }'
    )
    expect(model.calls.at(-1)!.systemPrompts[0]).toContain('data-qb-part')
    const refused = await ask([{ path: 'css', value: '"@import url(/x.css);"' }], 'Do it', on)
    expect(refused.ok && refused.reply).toContain('no @import')
  })

  it('tells the model which Home blocks this workspace can show', async () => {
    await ask([], 'Do it', { ...ALLOWS, blockTypes: ['welcome', 'composer'] })
    expect(model.calls.at(-1)!.systemPrompts[0]).toContain(
      'This workspace can show: welcome, composer.'
    )
  })
})

describe('a logo or a screenshot', () => {
  const look = {
    name: 'Faithful',
    description: 'Close to the site.',
    preset: DESIGN_PRESETS[0]!.id,
    accent: '#1f4d3a',
    background: '#f6efe2',
    ink: '#22201c',
    headingFont: 'fraunces',
    bodyFont: 'inter',
    headline: 'Tell us',
    subtitle: 'Ideas welcome.',
  }

  it('is shown to the model as well as its colours', async () => {
    model.answer = { looks: [look] }
    await designDirections({
      allows: ALLOWS,
      design: defaultDesign(),
      site: null,
      words: null,
      palette: ['#1f4d3a', '#f6efe2'],
      image: 'data:image/jpeg;base64,AAAA',
    })
    const content = model.calls[0]!.messages[0]!.content as Array<Record<string, unknown>>
    expect(content[0]).toMatchObject({ type: 'text' })
    expect(content[1]).toEqual({
      type: 'image',
      source: { type: 'data', value: 'AAAA', mimeType: 'image/jpeg' },
    })
  })

  it('leaves a model that does not take images with the colours', async () => {
    model.answer = { looks: [look] }
    model.refusesImages = true
    const result = await designDirections({
      allows: ALLOWS,
      design: defaultDesign(),
      site: null,
      words: null,
      palette: ['#1f4d3a', '#f6efe2'],
      image: 'data:image/jpeg;base64,AAAA',
    })
    expect(result.ok).toBe(true)
    expect(model.calls).toHaveLength(2)
    expect(model.calls[1]!.messages[0]!.content).toContain('#1f4d3a')
  })

  it('asks again once when the looks do not fit the schema', async () => {
    model.answer = { looks: [look] }
    model.misfits = 1
    const result = await designDirections({
      allows: ALLOWS,
      design: defaultDesign(),
      site: null,
      words: 'calm',
    })
    expect(result.ok).toBe(true)
    expect(model.calls).toHaveLength(2)
    model.misfits = 2
    model.calls = []
    expect(
      await designDirections({ allows: ALLOWS, design: defaultDesign(), site: null, words: 'calm' })
    ).toMatchObject({ ok: false, code: 'AI_FAILED' })
    expect(model.calls).toHaveLength(2)
  })
})
