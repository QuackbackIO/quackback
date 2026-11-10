/**
 * Quackback AI's answers reach the draft only through the design's own
 * checks: an unknown value is dropped, an off-schema answer is a refusal, and
 * with no model set up Appearance says so instead of failing.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultDesign, portalDesign } from '@/lib/shared/design/schema'
import { resolveDesign } from '@/lib/shared/design/resolve'
import { oneSentence } from '@/lib/shared/design/ai-reach'
import { writtenInEnglish } from '../design-ai-view'
import { DESIGN_PRESETS } from '@/lib/shared/design/presets'
import type { HomeBlockType } from '@/lib/shared/design/home'

const model = vi.hoisted(() => ({
  configured: true,
  answer: null as unknown,
  error: null as unknown,
  calls: [] as Array<{
    systemPrompts: string[]
    messages: Array<{ content: unknown }>
    middleware?: Array<{ params?: Record<string, unknown> }>
  }>,
  refusesImages: false,
  /** The server's line in the request's language, when asked for; null fails the call. */
  translated: null as string | null,
  /** Answers that do not fit the schema before one that does. */
  misfits: 0,
  /** A complete look; a test's look names only what it is about. */
  fullLook: {} as Record<string, unknown>,
  allowance: { credits: 'available', resetsAt: null, trial: false } as {
    credits: 'available' | 'none' | 'used'
    resetsAt: string | null
    trial: boolean
  },
}))

vi.mock('@/lib/server/config', () => ({ config: { openaiApiKey: 'key', openaiBaseUrl: 'url' } }))
vi.mock('@/lib/server/domains/ai/config', () => ({
  isAiClientConfigured: () => model.configured,
}))
vi.mock('@/lib/server/domains/ai/models', () => ({ getChatModel: () => 'test-model' }))
vi.mock('@/lib/server/domains/settings/tier-enforce', () => ({
  aiAllowanceNow: async () => model.allowance,
}))
vi.mock('@/lib/server/domains/ai/usage-middleware', () => ({
  createUsageLoggingMiddleware: (params: Record<string, unknown>) => ({ name: 'usage', params }),
}))
vi.mock('@/lib/server/domains/ai/structured-chat', () => ({
  structuredChat: async (input: {
    systemPrompts: string[]
    messages: Array<{ content: unknown }>
  }) => {
    model.calls.push(input)
    if (input.systemPrompts[0]?.startsWith('Write the line in the language')) {
      if (model.translated === null) throw new Error('no translation')
      return { reply: model.translated }
    }
    if (model.error) throw model.error
    if (model.misfits > 0) {
      model.misfits--
      throw Object.assign(new Error('did not fit'), { code: 'structured-output-validation-failed' })
    }
    if (model.refusesImages && Array.isArray(input.messages[0]?.content))
      throw new Error('this model does not take images')
    const answer = model.answer as { looks?: Array<Record<string, unknown>> } | null
    if (answer?.looks) {
      // One look to a call: the role names which.
      const role = input.systemPrompts[1] ?? ''
      const index = /second/.test(role) ? 1 : /third/.test(role) ? 2 : 0
      const look = answer.looks[index]
      if (!look) throw new Error('no look for this role')
      return { look: { ...model.fullLook, ...look } }
    }
    return model.answer
  },
}))

const { askDesignAi, designDirections, editSchema, linksGiven, OPS_EXAMPLES, parseValue } =
  await import('../design-ai')
const { applyOps } = await import('@/lib/shared/design/design-ops')
const { newBlock, starterHomeBlocks } = await import('@/lib/shared/design/home')

const GATES = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: true,
  support: true,
  status: true,
}
const NO_PLACES = { boards: [], roadmaps: [], categories: [] }
/** An operation as the model writes it, every field a string. */
const op = (
  fields: { op: string; target?: string; key?: string; value?: string },
  says: string
) => ({ target: '', key: '', value: '', ...fields, says })
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
  model.translated = null
  model.error = null
  model.calls = []
  model.allowance = { credits: 'available', resetsAt: null, trial: false }
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

  it('says plainly when the AI allowance is used, without asking the model', async () => {
    const ask = () =>
      askDesignAi({
        message: 'Make it green',
        design: defaultDesign(),
        scope: 'site',
        history: [],
        allows: ALLOWS,
      })
    model.allowance = { credits: 'used', resetsAt: '2026-12-01T00:00:00.000Z', trial: false }
    expect(await ask()).toEqual({
      ok: false,
      code: 'AI_LIMIT',
      message:
        'Quackback AI has used this month’s allowance; it comes back on 1 December. Every setting still works.',
    })
    model.allowance = { credits: 'used', resetsAt: null, trial: true }
    expect(await ask()).toMatchObject({
      message: 'Quackback AI has used this trial’s allowance. Every setting still works.',
    })
    model.allowance = { credits: 'none', resetsAt: null, trial: false }
    expect(await ask()).toMatchObject({
      message: 'Quackback AI is not on this plan. Every setting still works.',
    })
    model.allowance = { credits: 'used', resetsAt: null, trial: false }
    expect(
      await designDirections({ allows: ALLOWS, design: defaultDesign(), words: 'calm' })
    ).toMatchObject({ ok: false, code: 'AI_LIMIT' })
    expect(model.calls).toEqual([])
  })

  it('is told the page and language shown, writes words in that language and says which', async () => {
    model.answer = {
      reply: 'Done.',
      outOfScope: false,
      ops: [op({ op: 'words', target: 'feedback', key: 'title', value: 'Hilf uns' }, 'headline')],
    }
    const result = await askDesignAi({
      message: 'Change the headline to Hilf uns',
      design: defaultDesign(),
      scope: 'site',
      history: [],
      allows: ALLOWS,
      page: 'feedback',
      locale: 'de',
    })
    if (!result.ok) throw new Error('expected a result')
    expect(result.design.pages.feedback.headline?.title).toEqual({ de: 'Hilf uns' })
    // One sentence; the language is said under Show changes.
    expect(result.reply).toBe('Done.')
    expect(result.notes).toEqual(['The words are in German, the language shown.'])
    expect(model.calls[0]!.systemPrompts[1]).toContain(
      'The person is looking at the Feedback page. The page is shown in German: write any words they ask for in German.'
    )
  })

  it('applies what fits and drops what does not', async () => {
    model.answer = {
      reply: 'Done.',
      ops: [
        op({ op: 'theme', key: 'accent', value: '#0f766e' }, 'the brand colour to teal'),
        op({ op: 'theme', key: 'cards', value: 'floating' }, 'the cards to floating'),
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
    // What was left alone is named with why, under Show changes, so the reply never overclaims.
    expect(result).toMatchObject({
      ok: true,
      reply: 'I changed the brand colour to teal.',
      notes: ['I left the rest: cards can be bordered, raised, list or filled.'],
      skipped: 1,
    })
    expect(result.ok && result.applied.map((change) => [change.path, change.label])).toEqual([
      ['brand.light.accent', 'Brand colour to #0f766e'],
    ])
  })

  it('names what the solver adjusted to keep text readable', async () => {
    model.answer = {
      reply: 'Done.',
      ops: [op({ op: 'theme', key: 'accent', value: '#fde047' }, '')],
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

  it('tells the model the part picked, the portal as it is and the operations it has', async () => {
    model.answer = { reply: 'Done.', ops: [], outOfScope: false }
    const design = defaultDesign()
    design.tune = { headline: { size: 72, weight: 700 } }
    await askDesignAi({
      message: 'Pills',
      design,
      scope: 'header',
      history: [],
      allows: ALLOWS,
    })
    const [guide, now] = model.calls[0]!.systemPrompts
    expect(now).toContain('The person picked the header in the preview. Change only it.')
    expect(now).toContain(
      'headline 72px, weight 700 on wide screens (smaller on phones), spacing -0.02em'
    )
    expect(now).toContain('Menu, in order: feedback "Feedback" (visitors land here)')
    expect(guide).toContain('menuStyle: How the menu marks the current page')
    expect(guide).toContain('- move: target a Home block; value where it goes')
    // The model is never shown the document to write paths into.
    expect(now).not.toContain('"version":2')
  })

  it('names the workspace’s boards, roadmaps and topics, and resolves them to ids', async () => {
    const design = defaultDesign()
    design.pages.home.blocks = [
      {
        type: 'ideas',
        id: 'ideasaaaaa',
        sort: 'trending',
        count: 3,
        grid: { x: 0, y: 0, w: 6, h: 1 },
      },
    ]
    model.answer = {
      reply: 'Top posts now comes from Mobile.',
      outOfScope: false,
      ops: [
        op({ op: 'set', target: 'ideasaaaaa', key: 'boardIds', value: '["Mobile"]' }, 'boards'),
      ],
    }
    const mobile = 'board_01h455vb4pex5vsknk084sn02q'
    const result = await askDesignAi({
      message: 'Only Mobile',
      design,
      scope: 'site',
      history: [],
      allows: ALLOWS,
      places: { boards: [{ id: mobile, name: 'Mobile' }], roadmaps: [], categories: [] },
    })
    if (!result.ok) throw new Error('expected an answer')
    expect(result.design.pages.home.blocks[0]).toMatchObject({ boardIds: [mobile] })
    expect(model.calls[0]!.systemPrompts[0]).toContain('a list of names, from Mobile')
    expect(model.calls[0]!.systemPrompts[1]).toContain('The workspace’s boards: Mobile.')
    expect(model.calls[0]!.systemPrompts.join('\n')).not.toContain(mobile)
  })

  it('says plainly when a request is outside the section, whatever the model wrote', async () => {
    model.answer = {
      reply: 'I added a coloured hero.',
      ops: [op({ op: 'set', target: 'hero', key: 'look', value: 'brand' }, 'the hero')],
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

  it('never reaches from a picked Home block into the page of the same name', async () => {
    const design = defaultDesign()
    design.nav.home.on = true
    design.pages.home.blocks = [
      { type: 'roadmap', id: 'roadmapaaa', roadmapId: null, grid: { x: 0, y: 0, w: 12, h: 4 } },
    ]
    model.answer = {
      reply: 'The roadmap is a list now.',
      // "roadmap" names the block and the page; board is the page's setting.
      ops: [op({ op: 'set', target: 'roadmap', key: 'board', value: 'list' }, 'roadmap as a list')],
      outOfScope: false,
    }
    const result = await askDesignAi({
      message: 'Show it as a list',
      design,
      scope: 'home',
      blockId: 'roadmapaaa',
      history: [],
      allows: ALLOWS,
    })
    if (!result.ok) throw new Error('expected an answer')
    expect(result.applied).toEqual([])
    expect(result.design.pages.roadmap).toEqual(design.pages.roadmap)
    expect(result.reply).toBe('That is outside the Roadmap block on Home, so nothing changed.')
    expect(result.reply).not.toMatch(/list/i)
  })

  it('keeps a request about one Home block to that block', async () => {
    const design = defaultDesign()
    design.nav.home.on = true
    design.pages.home.blocks = [
      { type: 'status', id: 'statusaaaa', grid: { x: 0, y: 0, w: 4, h: 4 } },
      { type: 'contact', id: 'contactbbb', grid: { x: 0, y: 4, w: 12, h: 4 } },
    ]
    model.answer = {
      reply: 'Both have new headings.',
      ops: [
        op(
          { op: 'set', target: 'contactbbb', key: 'heading', value: 'Talk to us' },
          'the contact heading'
        ),
        op({ op: 'set', target: 'statusaaaa', key: 'heading', value: 'Up?' }, 'the status heading'),
      ],
      outOfScope: false,
    }
    const result = await askDesignAi({
      message: 'Give it a friendlier heading',
      design,
      scope: 'home',
      blockId: 'contactbbb',
      history: [],
      allows: ALLOWS,
    })
    if (!result.ok) throw new Error('expected an answer')
    expect(result.design.pages.home.blocks.map((block) => block.heading)).toEqual([
      undefined,
      { en: 'Talk to us' },
    ])
    expect(result.reply).toBe('I changed the contact heading.')
    expect(result.notes).toEqual([
      'Part of that is outside the Contact block on Home and was left alone.',
    ])
    // The request is about the block picked: no offer to ask about the whole site.
    expect(result.outOfScope).toBe(false)
    expect(model.calls.at(-1)!.systemPrompts[1]).toContain(
      'The person picked Contact (contactbbb); "this" and "it" mean it.'
    )
  })

  it('answers a request in another language in the model’s own words, never English labels', async () => {
    const design = defaultDesign()
    design.nav.home.on = true
    design.pages.home.blocks = [
      { type: 'status', id: 'statusaaaa', grid: { x: 0, y: 0, w: 4, h: 4 } },
      { type: 'contact', id: 'contactbbb', grid: { x: 0, y: 4, w: 12, h: 4 } },
    ]
    model.answer = {
      reply: 'Der Kontaktblock hat jetzt eine freundlichere Überschrift.',
      ops: [
        op(
          { op: 'set', target: 'contactbbb', key: 'heading', value: 'Schreib uns' },
          'die Überschrift des Kontaktblocks'
        ),
        op(
          { op: 'set', target: 'statusaaaa', key: 'heading', value: 'Läuft?' },
          'die Statusüberschrift'
        ),
      ],
      outOfScope: false,
    }
    const result = await askDesignAi({
      message: 'Gib ihm eine freundlichere Überschrift',
      design,
      scope: 'home',
      blockId: 'contactbbb',
      history: [],
      allows: ALLOWS,
    })
    if (!result.ok) throw new Error('expected an answer')
    expect(result.applied).toHaveLength(1)
    expect(result.reply).toBe('Der Kontaktblock hat jetzt eine freundlichere Überschrift.')
    // The model is told to answer in the request's language, naming parts in it.
    expect(model.calls.at(-1)!.systemPrompts[1]).toContain(
      'Write reply and says in the language of the request'
    )
  })

  it('reads which requests are in English', () => {
    for (const english of ['Calmer', 'Give it a friendlier heading', 'Make the buttons rounder'])
      expect(writtenInEnglish(english), english).toBe(true)
    for (const other of [
      'Gib ihm eine freundlichere Überschrift',
      'Pon los botones en negro',
      'Mach alle Buttons schwarz',
      'このボタンだけを黒にして',
    ])
      expect(writtenInEnglish(other), other).toBe(false)
  })

  it('passes the colours of an attached image with the request', async () => {
    model.answer = { reply: 'Done.', ops: [], outOfScope: false }
    await askDesignAi({
      message: 'Use these colours',
      design: defaultDesign(),
      scope: 'site',
      history: [],
      allows: ALLOWS,
      images: [{ palette: ['#7a1f35', '#ffffff'] }],
    })
    const sent = model.calls[0] as unknown as { messages: Array<{ content: string }> }
    expect(sent.messages.at(-1)!.content).toBe(
      'Use these colours\n\nColours from the attached image: #7a1f35, #ffffff. The brand colour, the most used colour that is not a neutral: #7a1f35.'
    )
  })

  it('shows the model the attached picture itself, so a request to match it can be read', async () => {
    model.answer = { reply: 'Done.', ops: [], outOfScope: false }
    await askDesignAi({
      message: 'Match our site',
      design: defaultDesign(),
      scope: 'site',
      history: [],
      allows: ALLOWS,
      images: [{ palette: ['#163300'], image: 'data:image/jpeg;base64,AAAA' }],
    })
    const content = model.calls[0]!.messages.at(-1)!.content as Array<Record<string, unknown>>
    expect(content[0]).toMatchObject({ type: 'text' })
    expect(content[1]).toEqual({
      type: 'image',
      source: { type: 'data', value: 'AAAA', mimeType: 'image/jpeg' },
    })
  })

  it('shows the model every attached picture, with each one’s colours', async () => {
    model.answer = { reply: 'Done.', ops: [], outOfScope: false }
    await askDesignAi({
      message: 'Blend these',
      design: defaultDesign(),
      scope: 'site',
      history: [],
      allows: ALLOWS,
      images: [
        { palette: ['#163300'], image: 'data:image/jpeg;base64,AAAA' },
        { palette: ['#7a1f35'], image: 'data:image/jpeg;base64,BBBB' },
        { palette: ['#0000ff'] },
      ],
    })
    const content = model.calls[0]!.messages.at(-1)!.content as Array<{
      type: string
      content?: string
      source?: { value: string }
    }>
    expect(content.filter((part) => part.type === 'image').map((p) => p.source?.value)).toEqual([
      'AAAA',
      'BBBB',
    ])
    const text = content[0]!.content ?? ''
    expect(text).toContain('image 1: #163300')
    expect(text).toContain('image 2: #7a1f35')
    expect(text).toContain('image 3: #0000ff')
  })

  it('asks once more when an answer does not fit, then without the picture', async () => {
    model.answer = { reply: 'Done.', ops: [], outOfScope: false }
    model.misfits = 2
    const result = await askDesignAi({
      message: 'Match our site',
      design: defaultDesign(),
      scope: 'site',
      history: [],
      allows: ALLOWS,
      images: [{ palette: ['#163300'], image: 'data:image/jpeg;base64,AAAA' }],
    })
    expect(result.ok).toBe(true)
    expect(model.calls).toHaveLength(3)
    // The last ask carries the picture's colours, not the picture.
    expect(typeof model.calls[2]!.messages.at(-1)!.content).toBe('string')
  })

  it('says nothing changed when everything asked for is already set, whatever the model wrote', async () => {
    model.answer = {
      reply: 'I put the logo above the menu.',
      ops: [op({ op: 'theme', key: 'header', value: 'stacked' }, 'the logo above the menu')],
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
    expect(result.reply).toBe('Nothing changed: it is already like that.')
  })

  it('says only what applied when part of an answer did not', async () => {
    const design = defaultDesign()
    design.layout.density = 'spacious'
    model.answer = {
      reply: 'I raised the cards and gave the feed more room.',
      ops: [
        op({ op: 'theme', key: 'cards', value: 'raised' }, ''),
        op({ op: 'theme', key: 'density', value: 'spacious' }, 'the feed more room'),
      ],
      outOfScope: false,
    }
    const result = await askDesignAi({
      message: 'Raised cards, more room',
      design,
      scope: 'site',
      history: [],
      allows: ALLOWS,
    })
    // An operation without its own words is named by its label.
    expect(result.ok && result.reply).toBe('I changed cards to raised.')
  })

  it('never claims a change the design refused', async () => {
    model.answer = {
      reply: 'Your cards now float.',
      ops: [op({ op: 'theme', key: 'cards', value: 'floating' }, '')],
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
    expect(result.reply).toBe('Nothing changed: cards can be bordered, raised, list or filled.')
    expect(result.outOfScope).toBe(false)
  })

  it('records every call it makes against the AI allowance', async () => {
    model.answer = { reply: 'Done.', ops: [], outOfScope: false }
    model.misfits = 1
    await askDesignAi({
      message: 'Anything',
      design: defaultDesign(),
      scope: 'site',
      history: [],
      allows: ALLOWS,
    })
    expect(model.calls).toHaveLength(2)
    for (const call of model.calls)
      expect(call.middleware?.map((m) => m.params)).toEqual([
        { pipelineStep: 'design', model: 'test-model', metadata: { call: 'edit' } },
      ])
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
          hero: 'tint',
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
      words: 'calm',
      palette: ['#0f766e', '#f8fafc'],
    })
    const brief = (model.calls[0] as unknown as { messages: Array<{ content: string }> })
      .messages[0].content
    expect(brief).toContain(
      "Their images' main colours by area: #0f766e, #f8fafc. The brand colour, the most used colour that is not a neutral: #0f766e."
    )
    if (!result.ok) throw new Error('expected looks')
    expect(result.looks.map((look) => look.name)).toEqual(['Calm', 'Editorial'])
    expect(result.looks[0].design.layout.hero).toBe('tint')
    expect(result.looks[0].design.brand.light.accent).toBe('#0f766e')
    expect(result.looks[0].preset).toBe('calm')
    expect(result.looks[0].design.pages.feedback.headline).toEqual({
      title: { en: 'Help us grow' },
      subtitle: { en: 'Share posts and vote.' },
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
  /** Changes by path, as the brand match and others write them, with the checks on the model's. */
  const ask = (
    changes: Array<{ path: string; value: string }>,
    message = 'Do it',
    allows: typeof ALLOWS = ALLOWS
  ) =>
    applyDesignChanges(
      defaultDesign(),
      changes.map((change) => ({ path: change.path, value: parseValue(change.value) })),
      'site',
      { ...allows, links: linksGiven([message]) }
    )
  const reasons = (result: ReturnType<typeof ask>) => result.refused.map((each) => each.reason)

  it('takes the links a person gave: web addresses, and emails as mailto links', () => {
    expect([
      ...linksGiven(['Link https://docs.acme.com and mail help@acme.com or mailto:sales@acme.co']),
    ]).toEqual(['https://docs.acme.com', 'mailto:help@acme.com', 'mailto:sales@acme.co'])
  })

  it('keeps every example it shows the model valid', () => {
    for (const example of OPS_EXAMPLES) {
      const design = defaultDesign()
      design.nav.home.on = true
      design.pages.home.blocks = starterHomeBlocks(GATES)
      design.pages.home.blocks.push(newBlock('help_search', { y: 9 }))
      if (example.picked?.includes('raised')) design.layout.cards = 'raised'
      const result = applyOps(
        portalDesign.parse(design),
        { gates: GATES, places: NO_PLACES, untrusted: { ...ALLOWS, links: new Set() } },
        example.answer.ops,
        example.picked?.startsWith('Top posts')
          ? { scope: 'home', blockId: design.pages.home.blocks.find((b) => b.type === 'ideas')!.id }
          : { scope: 'site' }
      )
      expect(result.refused, example.request).toEqual([])
      expect(result.outOfScope, example.request).toEqual([])
      expect(result.done.length, example.request).toBe(example.answer.ops.length)
    }
  })

  it('shows the model replies of one sentence only, as its own replies must be', () => {
    for (const example of OPS_EXAMPLES) {
      expect(oneSentence(example.answer.reply), example.request).toBe(example.answer.reply)
      // The few-shot JSON is an answer the model's schema takes.
      expect(editSchema.safeParse(example.answer).success, example.request).toBe(true)
    }
  })

  it('shows the model a picked block’s heading set in the second colour', () => {
    const example = OPS_EXAMPLES.find((each) =>
      /block's heading in the second colour/i.test(each.request)
    )
    expect(example?.answer.ops).toEqual([
      expect.objectContaining({ op: 'set', key: 'style.heading.base.color', value: 'support' }),
    ])
  })

  it('keeps the answer’s grammar flat: a few strings per operation, no nesting', () => {
    const item = editSchema.shape.ops.element.shape
    expect(Object.keys(item)).toEqual(['op', 'target', 'key', 'value', 'says'])
    for (const [key, field] of Object.entries(item))
      expect(['ZodString', 'ZodEnum'], key).toContain(field.constructor.name)
  })

  it('builds Home from blocks written by type and the width they had before the grid', () => {
    const result = ask([
      { path: 'nav.home.on', value: 'true' },
      {
        path: 'pages.home.blocks',
        value:
          '[{"type":"welcome","width":"full","body":"Hello there."},{"type":"composer","width":"two_thirds"},{"type":"status","width":"third"},{"type":"ideas","width":"half"}]',
      },
    ])
    expect(result.design.nav.home.on).toBe(true)
    const places = result.design.pages.home.blocks.map(({ type, grid }) => [type, grid])
    expect(places).toEqual([
      ['welcome', { x: 0, y: 0, w: 12, h: 1 }],
      ['composer', { x: 0, y: 1, w: 8, h: 1 }],
      ['status', { x: 8, y: 1, w: 4, h: 1 }],
      ['ideas', { x: 0, y: 2, w: 12, h: 1 }],
    ])
    expect(result.design.pages.home.blocks[3]).toMatchObject({ sort: 'trending', count: 3 })
  })

  it('places blocks written with places on the grid, floated up and kept apart', () => {
    const result = ask([
      { path: 'nav.home.on', value: 'true' },
      {
        path: 'pages.home.blocks',
        value:
          '[{"type":"ideas","grid":{"x":0,"y":5,"w":6,"h":8}},{"type":"updates","grid":{"x":3,"y":5,"w":6,"h":8}},{"type":"status","grid":{"x":10,"y":0,"w":4,"h":1}}]',
      },
    ])
    const places = result.design.pages.home.blocks.map(({ type, grid }) => [type, grid])
    expect(places).toEqual([
      ['ideas', { x: 0, y: 0, w: 6, h: 8 }],
      ['status', { x: 8, y: 0, w: 4, h: 1 }],
      ['updates', { x: 3, y: 8, w: 6, h: 8 }],
    ])
  })

  it('words the menu and own wording in any language, but never renames posts', () => {
    const result = ask([
      { path: 'vocabulary.post', value: '"suggestion"' },
      {
        path: 'pages.feedback.copy.prompt',
        value: '{"en":"Pitch an idea","de":"Schlag etwas vor"}',
      },
      { path: 'nav.items.2.shown', value: 'false' },
    ])
    expect(result.design).not.toHaveProperty('vocabulary')
    expect(result.skipped).toBe(1)
    expect(result.design.pages.feedback.copy.prompt).toEqual({
      en: 'Pitch an idea',
      de: 'Schlag etwas vor',
    })
    expect(result.design.nav.items[2]).toMatchObject({ type: 'changelog', shown: false })
  })

  it('takes no link, file or Home block the workspace did not give it, and says why', () => {
    const result = ask(
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
    expect(result.applied).toEqual([])
    expect(reasons(result)).toContain('https://shop.example.com is not a link you gave')
    expect(reasons(result)).toContain('images and fonts are uploaded in Brand')
    expect(reasons(result)).toContain('the status block needs its page on')

    const given = ask(
      [
        {
          path: 'pages.home.blocks',
          value:
            '[{"type":"links","width":"third","links":[{"label":"Docs","url":"https://docs.example.com"}]}]',
        },
      ],
      'Add our docs, https://docs.example.com'
    )
    expect(given.applied.map((change) => change.path)).toEqual(['pages.home.blocks'])
  })

  it('writes CSS only where the workspace lets it, and only CSS the check passes', async () => {
    const css = '[data-qb-part="post-card"] { border-width: 2px; }'
    model.answer = {
      reply: 'Done.',
      outOfScope: false,
      ops: [op({ op: 'theme', key: 'css', value: css }, 'the cards’ edges')],
    }
    const off = await askDesignAi({
      message: 'Do it',
      design: defaultDesign(),
      scope: 'site',
      history: [],
      allows: ALLOWS,
    })
    expect(off.ok && off.applied).toEqual([])
    expect(off.ok && off.reply).toContain('Quackback AI does not write CSS')
    expect(model.calls.at(-1)!.systemPrompts[0]).not.toContain('data-qb-part')

    const on = {
      ...ALLOWS,
      writesCss: true,
      checkCss: (text: string) => (text.includes('@import') ? 'no @import' : null),
    }
    const written = await askDesignAi({
      message: 'Do it',
      design: defaultDesign(),
      scope: 'site',
      history: [],
      allows: on,
    })
    expect(written.ok && written.design.css).toBe(css)
    expect(model.calls.at(-1)!.systemPrompts[0]).toContain('data-qb-part')
    model.answer = {
      reply: 'Done.',
      outOfScope: false,
      ops: [op({ op: 'theme', key: 'css', value: '@import url(/x.css);' }, '')],
    }
    const refused = await askDesignAi({
      message: 'Do it',
      design: defaultDesign(),
      scope: 'site',
      history: [],
      allows: on,
    })
    expect(refused.ok && refused.reply).toContain('no @import')
  })

  it('tells the model which Home blocks this workspace can show', async () => {
    model.answer = { reply: 'Done.', outOfScope: false, ops: [] }
    await askDesignAi({
      message: 'Do it',
      design: defaultDesign(),
      scope: 'site',
      history: [],
      allows: { ...ALLOWS, blockTypes: ['welcome', 'composer'] },
    })
    const guide = model.calls.at(-1)!.systemPrompts[0]!
    expect(guide).toContain('welcome ("Welcome"): A few words of your own.')
    expect(guide).toContain('composer ("Write a post")')
    expect(guide).not.toContain('help_search ("Help search")')
  })
})

describe('screenshots of their brand', () => {
  const look = {
    name: 'Faithful',
    description: 'Close to theirs.',
    preset: DESIGN_PRESETS[0]!.id,
    accent: '#fe8c23',
    background: '#ffffff',
    ink: '#0a2540',
    headingFont: 'inter',
    bodyFont: 'inter',
    headline: 'Tell us',
    subtitle: 'Ideas welcome.',
  }
  const shots = (n: number) =>
    Array.from({ length: n }, (_, i) => `data:image/jpeg;base64,SHOT${i}`)

  it('shows the model every image, and the colours measured from their buttons and links', async () => {
    model.answer = { looks: [look] }
    await designDirections({
      allows: ALLOWS,
      design: defaultDesign(),
      words: null,
      images: shots(2),
      colours: ['#533afd', '#40668d'],
      palette: ['#fe8c23', '#ffffff'],
    })
    const faithful = model.calls.find((c) => c.systemPrompts[1]?.startsWith('Write the first'))!
    const content = faithful.messages[0]!.content as Array<Record<string, unknown>>
    expect(content.filter((part) => part.type === 'image')).toHaveLength(2)
    expect(JSON.stringify(content[0])).toContain('#533afd, #40668d')
  })

  it('keeps the measured brand colour when the model reads another', async () => {
    model.answer = { looks: [look, look] }
    const result = await designDirections({
      allows: ALLOWS,
      design: defaultDesign(),
      words: null,
      images: shots(1),
      colours: ['#533afd', '#40668d'],
      palette: ['#fe8c23'],
    })
    if (!result.ok) throw new Error('expected looks')
    expect(result.looks[0]!.design.brand.light.accent).toBe('#533afd')
    // The other looks are directions of their own.
    expect(result.looks[1]!.design.brand.light.accent).toBe('#fe8c23')
  })

  it('takes the model’s colour where the measured ones bear it out, and a near-black as it is', async () => {
    model.answer = { looks: [{ ...look, accent: '#40668e' }] }
    const borne = await designDirections({
      allows: ALLOWS,
      design: defaultDesign(),
      words: null,
      images: shots(1),
      colours: ['#533afd', '#40668d'],
    })
    if (!borne.ok) throw new Error('expected looks')
    expect(borne.looks[0]!.design.brand.light.accent).toBe('#40668d')
    model.answer = { looks: [{ ...look, accent: '#111111' }] }
    const mono = await designDirections({
      allows: ALLOWS,
      design: defaultDesign(),
      words: null,
      images: shots(1),
      colours: ['#533afd'],
    })
    if (!mono.ok) throw new Error('expected looks')
    expect(mono.looks[0]!.design.brand.light.accent).toBe('#111111')
  })
})

describe('a muddy colour the model reads', () => {
  it('gives way to the measured brand colour: a photo’s brown is not a monochrome brand', async () => {
    model.answer = {
      looks: [
        {
          name: 'Faithful',
          description: 'Theirs.',
          preset: DESIGN_PRESETS[0]!.id,
          accent: '#412e1c',
          background: '#ffffff',
          ink: '#111111',
          headingFont: 'inter',
          bodyFont: 'inter',
          headline: 'Tell us',
          subtitle: 'Ideas welcome.',
        },
      ],
    }
    const result = await designDirections({
      allows: ALLOWS,
      design: defaultDesign(),
      words: null,
      images: ['data:image/jpeg;base64,AAAA'],
      colours: ['#0058a3', '#ca5008'],
    })
    if (!result.ok) throw new Error('expected looks')
    expect(result.looks[0]!.design.brand.light.accent).toBe('#0058a3')
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
      words: null,
      palette: ['#1f4d3a', '#f6efe2'],
      images: ['data:image/jpeg;base64,AAAA'],
    })
    const content = model.calls[0]!.messages[0]!.content as Array<Record<string, unknown>>
    expect(content[0]).toMatchObject({ type: 'text' })
    expect(content[1]).toEqual({
      type: 'image',
      source: { type: 'data', value: 'AAAA', mimeType: 'image/jpeg' },
    })
  })

  it('records the looks and the hero read against the AI allowance', async () => {
    model.answer = { looks: [look, look, look] }
    await designDirections({
      allows: ALLOWS,
      design: defaultDesign(),
      words: null,
      palette: ['#1f4d3a'],
      images: ['data:image/jpeg;base64,AAAA'],
    })
    const steps = model.calls.map((call) => call.middleware?.[0]?.params)
    expect(steps.filter((p) => p?.pipelineStep === 'design')).toHaveLength(model.calls.length)
    expect(new Set(steps.map((p) => (p?.metadata as { call: string }).call))).toEqual(
      new Set(['look', 'hero'])
    )
  })

  it('tells the model when the workspace has a logo mark', async () => {
    model.answer = { looks: [look] }
    await designDirections({
      allows: ALLOWS,
      design: defaultDesign(),
      name: 'Northwind Bikes',
      hasMark: true,
      words: 'Scandinavian bikes',
    })
    expect(model.calls[0]!.messages[0]!.content).toContain(
      'They have a logo mark, a square icon the header can show beside their name.'
    )
  })

  it('leaves a model that does not take images with the colours', async () => {
    model.answer = { looks: [look] }
    model.refusesImages = true
    const result = await designDirections({
      allows: ALLOWS,
      design: defaultDesign(),
      words: null,
      palette: ['#1f4d3a', '#f6efe2'],
      images: ['data:image/jpeg;base64,AAAA'],
    })
    expect(result.ok).toBe(true)
    // The faithful look is asked for with the picture, then with its colours alone.
    const faithful = model.calls.filter((call) =>
      call.systemPrompts[1]?.startsWith('Write the first')
    )
    expect(faithful).toHaveLength(2)
    expect(faithful[1]!.messages[0]!.content).toContain('#1f4d3a')
  })

  it('asks for a look once more when it does not fit the schema, and fails when none do', async () => {
    model.answer = { looks: [look] }
    model.misfits = 1
    const first = (call: { systemPrompts: string[] }) =>
      call.systemPrompts[1]?.startsWith('Write the first')
    expect(
      await designDirections({ allows: ALLOWS, design: defaultDesign(), words: 'calm' })
    ).toMatchObject({ ok: true })
    expect(model.calls.filter(first).length).toBeLessThanOrEqual(2)
    model.misfits = 100
    model.calls = []
    expect(
      await designDirections({ allows: ALLOWS, design: defaultDesign(), words: 'calm' })
    ).toMatchObject({ ok: false, code: 'AI_FAILED' })
    // Each look is asked for twice before it is given up.
    expect(model.calls.filter(first)).toHaveLength(2)
  })
})

describe('a request keeps as near as the chip says it reaches', () => {
  const calmer = {
    reply: 'The hero is calmer now. I softened its colour.',
    outOfScope: false,
    ops: [op({ op: 'set', target: 'hero', key: 'look', value: 'tint' }, 'the hero to a tint')],
  }
  const ask = (message: string, within: 'page' | 'every') => {
    const design = defaultDesign()
    design.nav.home.on = true
    design.layout.hero = 'brand'
    return askDesignAi({
      message,
      design,
      scope: 'band',
      within,
      page: 'home',
      history: [],
      allows: ALLOWS,
    })
  }

  for (const message of ['Make this calmer', 'Mach das ruhiger'])
    it(`with the hero picked for this page only, “${message}” changes no other page`, async () => {
      model.answer = calmer
      const result = await ask(message, 'page')
      if (!result.ok) throw new Error('expected an answer')
      expect(result.applied).toEqual([])
      expect(result.design.layout.hero).toBe('brand')
      // In German the line could not be put into German here, so it is said in English.
      expect(result.reply).toBe('That reaches beyond this page, so nothing changed.')
      // About the hero itself: no offer to ask about the whole site.
      expect(result.outOfScope).toBe(false)
    })

  it('says nothing changed in the request’s language, never the model’s claim that it did', async () => {
    model.answer = calmer
    model.translated =
      'Das reicht über diese Seite hinaus, also hat sich nichts geändert. Mehr nicht.'
    const result = await ask('Mach das ruhiger', 'page')
    if (!result.ok) throw new Error('expected an answer')
    expect(result.applied).toEqual([])
    expect(result.reply).toBe('Das reicht über diese Seite hinaus, also hat sich nichts geändert.')
    // The server's line went to be put into the request's language, with the request.
    const asked = JSON.stringify(model.calls.at(-1)!.messages)
    expect(asked).toContain('That reaches beyond this page, so nothing changed.')
    expect(asked).toContain('Mach das ruhiger')
  })

  it('asks for no other language for an English request, nor where the model said it was outside', async () => {
    model.answer = calmer
    model.translated = 'Never said'
    expect((await ask('Make this calmer', 'page')).ok && model.calls.length).toBe(1)
    model.calls = []
    model.answer = {
      reply: 'Eso no es parte de la cabecera, así que no cambié nada.',
      outOfScope: true,
      ops: [],
    }
    const result = await ask('Pon el menú en negro', 'page')
    expect(result.ok && result.reply).toBe(
      'Eso no es parte de la cabecera, así que no cambié nada.'
    )
    expect(model.calls.length).toBe(1)
  })

  it('with the hero picked for every page, says in one sentence that it changed every page', async () => {
    model.answer = calmer
    const result = await ask('Make this calmer', 'every')
    if (!result.ok) throw new Error('expected an answer')
    expect(result.design.layout.hero).toBe('tint')
    expect(result.reply).toBe('The hero is calmer now, on every page.')
  })

  it('says what else a shared field changes under Show changes', async () => {
    model.answer = {
      reply: 'Rounder corners.',
      outOfScope: false,
      ops: [op({ op: 'theme', key: 'corners', value: 'pill' }, 'the corners')],
    }
    const result = await askDesignAi({
      message: 'Rounder',
      design: defaultDesign(),
      scope: 'card',
      page: 'feedback',
      history: [],
      allows: ALLOWS,
    })
    if (!result.ok) throw new Error('expected an answer')
    expect(result.notes).toContain('Also changes the corners of cards, fields and buttons.')
  })

  it('tells the model how far it may reach', async () => {
    model.answer = calmer
    await ask('Make this calmer', 'page')
    expect(model.calls[0]!.systemPrompts[1]).toContain('Change it only on the Home page')
  })
})
