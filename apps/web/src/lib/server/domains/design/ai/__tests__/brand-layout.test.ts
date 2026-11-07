/**
 * Home's arrangement, asked on its own from the site: never the words writers' choice.
 */
import { describe, expect, it } from 'vitest'
import type { FamilyRequest } from '../brand-brief'
import {
  wordsEvidenceLines,
  type HomeArrangement,
  type VoiceAnswer,
  type WordsAnswer,
} from '../words-evidence'
import { createHash } from 'node:crypto'
import { WRITING_ANGLES } from '../words-examples'
import { agreedLayoutOf, LAYOUT_CONTEXT_V9, LAYOUT_VERSION, layoutPrompt } from '../words-layout'
import { writeWords } from '../words-pick'

const SITE = { headline: 'Money that moves', subtitle: 'Send it for less.', button: 'Get started' }

const VOICE: VoiceAnswer = {
  evidence: 'Plain and friendly.',
  name: 'Fernway',
  known: 'not',
  signatures: [],
  home_language: 'none',
  formality: 'neutral',
  humour: 'warm',
  exclamations: 'sometimes',
  emoji: 'never',
  vocabulary: ['send', 'spend'],
  avoid: [],
}

const set = (over: Partial<WordsAnswer> = {}): WordsAnswer => ({
  evidence: 'plain',
  home_layout: 'portal',
  home_headline: 'Help us make sending simpler',
  home_subtitle: 'Share ideas, see what is coming and find help.',
  feedback_headline: 'Your ideas',
  feedback_subtitle: 'Tell us what would help, and vote for the ideas you like.',
  prompt: 'What would make sending easier?',
  submit: 'Send it over',
  ...over,
})

const review = (s: 'a' | 'b' | 'c', plain_sense: number, voice = 3, delight = 3) => ({
  set: s,
  problems: [],
  plain_sense,
  voice,
  delight,
})

describe('Home’s arrangement', () => {
  const EV = { ...SITE, name: 'Acme', seen: [], pages: ['feedback'], language: null }
  const words = async <T>(request: FamilyRequest<T>): Promise<T> => {
    if (request.family === 'words_pick')
      return { reviews: [review('a', 5, 5, 5)], choice: 'a', swaps: [], why: '' } as T
    return set({ home_layout: 'feedback_first' }) as T
  }
  const run = (layouts: Record<string, HomeArrangement | Error>) =>
    writeWords({
      ev: EV,
      voice: VOICE,
      ms: 10_000,
      call: async <T>(request: FamilyRequest<T>): Promise<T> => {
        if (request.family !== 'layout') return words(request)
        const angle = WRITING_ANGLES.find((a) =>
          request.prompt.includes(LAYOUT_CONTEXT_V9.angles[a])
        )!
        const answer = layouts[angle]!
        if (answer instanceof Error) throw answer
        return { evidence: 'their site', home_layout: answer } as T
      },
    })

  it('is the one all three readings agree on, never the writers’ choice', async () => {
    const out = await run({ signature: 'help_first', plain: 'help_first', playful: 'help_first' })
    expect(out?.answer.home_layout).toBe('help_first')
  })

  it('stays the usual one on a split, as v9 did', async () => {
    const out = await run({ signature: 'help_first', plain: 'help_first', playful: 'portal' })
    expect(out?.answer.home_layout).toBe('portal')
  })

  it('takes two that agree when the third fails, and the usual one when only one answers', async () => {
    const two = await run({
      signature: 'roadmap_first',
      plain: new Error('down'),
      playful: 'roadmap_first',
    })
    expect(two?.answer.home_layout).toBe('roadmap_first')
    const one = await run({
      signature: 'roadmap_first',
      plain: new Error('down'),
      playful: new Error('down'),
    })
    expect(one?.answer.home_layout).toBe('portal')
    expect(agreedLayoutOf([])).toBe('portal')
  })

  it('is asked in the frozen v9 context, one reading per writing angle', () => {
    for (const angle of WRITING_ANGLES) {
      const prompt = layoutPrompt(EV, VOICE, angle)
      expect(prompt).toContain(LAYOUT_CONTEXT_V9.options)
      expect(prompt).toContain(LAYOUT_CONTEXT_V9.angles[angle])
      expect(prompt).toContain(wordsEvidenceLines(EV).join('\n'))
    }
    // The words step's later rules never reach it.
    expect(layoutPrompt(EV, VOICE, 'plain')).not.toMatch(/feedback first|offers their own service/)
  })

  it('holds the frozen context to words-v9’s text, byte for byte', () => {
    const { intro, options, angles } = LAYOUT_CONTEXT_V9
    const text = [intro, options, angles.signature, angles.plain, angles.playful].join('\n')
    expect(createHash('sha256').update(text, 'utf8').digest('hex')).toBe(
      '520f9721a0d6e91fd5d1ae70571df6ef71af6f0ae4894634ffa0f5993bce983e'
    )
    expect(LAYOUT_VERSION).toBe('layout-v9-frozen-1')
  })
})
