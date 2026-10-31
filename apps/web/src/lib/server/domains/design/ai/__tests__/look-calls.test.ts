/**
 * Looks written one to a call: each answer is linted for what a model can
 * leave out, a look with gaps is mended once and the mended one kept only
 * when it has fewer, and a look whose call fails leaves its place empty.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const model = vi.hoisted(() => ({
  /** Answers by role, in the order each role is asked. */
  answers: {} as Record<string, unknown[]>,
  calls: [] as Array<{ role: string; mending: boolean }>,
}))

vi.mock('@/lib/server/config', () => ({ config: {} }))
vi.mock('@/lib/server/domains/ai/structured-chat', () => ({
  structuredChat: async (input: { systemPrompts: string[]; messages: unknown[] }) => {
    const role = /first/.test(input.systemPrompts[1]!)
      ? 'first'
      : /second/.test(input.systemPrompts[1]!)
        ? 'second'
        : 'third'
    model.calls.push({ role, mending: input.messages.length > 1 })
    const next = model.answers[role]?.shift()
    if (!next) throw new Error('down')
    return { look: next }
  },
}))

const { DIRECTIONS_EXAMPLE } = await import('../design-looks')
const { lookLints, writeLooks } = await import('../look-calls')

const good = DIRECTIONS_EXAMPLE
const write = () => writeLooks({ model: 'm', systemPrompt: 'design', content: 'brief' })

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

  it('leaves a failed look’s place empty, so the faithful look is never another', async () => {
    model.answers = { second: [good], third: [good] }
    expect(await write()).toEqual([null, good, good])
  })
})
