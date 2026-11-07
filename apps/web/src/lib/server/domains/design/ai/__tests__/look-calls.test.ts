/**
 * Looks written one to a call: each answer is linted for what a model can
 * leave out, a look with gaps is mended once and the mended one kept only
 * when it has fewer, and a look whose call fails leaves its place empty.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const model = vi.hoisted(() => ({
  /** Answers by role, in the order each role is asked. */
  answers: {} as Record<string, unknown[]>,
  calls: [] as Array<{ role: string; mending: boolean; brief: unknown }>,
}))

vi.mock('@/lib/server/config', () => ({ config: {} }))
vi.mock('@/lib/server/domains/ai/structured-chat', () => ({
  structuredChat: async (input: { systemPrompts: string[]; messages: unknown[] }) => {
    const role = /first/.test(input.systemPrompts[1]!)
      ? 'first'
      : /second/.test(input.systemPrompts[1]!)
        ? 'second'
        : 'third'
    model.calls.push({
      role,
      mending: input.messages.length > 1,
      brief: (input.messages[0] as { content: unknown }).content,
    })
    const next = model.answers[role]?.shift()
    if (!next) throw new Error('down')
    return { look: next }
  },
}))

const { DIRECTIONS_EXAMPLE } = await import('../design-looks')
const { lookLints, writeLooks } = await import('../look-calls')

const good = DIRECTIONS_EXAMPLE
const picture = { type: 'image', source: { type: 'data', value: 'AAAA', mimeType: 'image/jpeg' } }
const write = () =>
  writeLooks({
    model: 'm',
    systemPrompt: 'design',
    content: (look) => [{ type: 'text', content: `brief for look ${look}` }, picture] as never,
  })

beforeEach(() => {
  model.answers = {}
  model.calls = []
})

describe('a look’s lints', () => {
  it('pass a complete look', () => {
    expect(lookLints(good)).toEqual([])
  })

  it('name what a model can leave out', () => {
    const lints = lookLints({
      ...good,
      pageWords: ['Roadmap', 'Coming soon', '', 'x'],
      headline: good.homeHeadline,
      band: 'support',
      support: '',
      homeBlocks: [],
    })
    expect(lints).toEqual(
      expect.arrayContaining([
        'pageWords: write all eight lines',
        `pageWords[0] "Roadmap" is only the page's name; write a title in their voice`,
        'pageWords[2] is empty',
        'headline repeats homeHeadline; give the feedback page its own',
        'the band, tint or action uses the second colour, but support is empty',
        'homeBlocks: give Home at least three blocks',
      ])
    )
  })
})

describe('looks written one to a call', () => {
  it('mends a look with gaps, keeping the mended one only when it has fewer', async () => {
    const gappy = { ...good, homeBlocks: [] }
    model.answers = {
      first: [gappy, good],
      second: [gappy, { ...gappy, pageWords: [] }],
      third: [good],
    }
    const [first, second, third] = await write()
    expect(first).toEqual(good)
    // The mend had more gaps, so the first answer stays.
    expect(second).toEqual(gappy)
    expect(third).toEqual(good)
    expect(
      model.calls
        .filter((call) => call.mending)
        .map((call) => call.role)
        .sort()
    ).toEqual(['first', 'second'])
  })

  it('gives each look its own brief, and mends from the words alone', async () => {
    model.answers = { first: [{ ...good, homeBlocks: [] }, good], second: [good], third: [good] }
    await write()
    const asked = model.calls.filter((call) => !call.mending)
    expect(
      asked.map((call) => (call.brief as Array<{ content?: string }>)[0]!.content).sort()
    ).toEqual(['brief for look 0', 'brief for look 1', 'brief for look 2'])
    const mend = model.calls.find((call) => call.mending)!
    expect(mend.brief).toEqual([{ type: 'text', content: 'brief for look 0' }])
  })

  it('leaves a failed look’s place empty, so the faithful look is never another', async () => {
    model.answers = { second: [good], third: [good] }
    expect(await write()).toEqual([null, good, good])
  })
})
