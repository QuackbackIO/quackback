import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { homeBlockTypes } from '@/lib/shared/design/home'
import { opsPrompt } from '../design-ai-guide'
import { OVERRIDE_OPS_EXAMPLES } from '../override-examples'
import { defaultDesign } from '@/lib/shared/design/schema'
import { wordsChanges } from '../brand-decide'
import { WORDS_EXAMPLES } from '../words-examples'
import { WORD_LINES, type WordsAnswer } from '../words-evidence'
import { postsInWords, postsWording } from '../words-posts'

const ON = { feedback: true, roadmap: true, changelog: true, help: true, support: true } as never

/** Each line as written, and as the portal should read it: a golden list. */
const GOLDEN: [string, string][] = [
  ['Share your idea', 'Share your post'],
  ['Share your ideas with us', 'Share your posts with us'],
  ['Got an idea for your deliveries?', 'Got feedback for your deliveries?'],
  ['Got an idea to make Discord more fun?', 'Got feedback to make Discord more fun?'],
  ['Have an idea? Tell us', 'Have feedback? Tell us'],
  ['Any ideas for the app?', 'Any feedback for the app?'],
  ['A feature, a fix or an idea?', 'A feature, a fix or something else?'],
  ['A feature, a fix or a idea?', 'A feature, a fix or something else?'],
  ['An idea for the roadmap', 'A post for the roadmap'],
  ['Vote for the ideas you like', 'Vote for the posts you like'],
  ['IDEAS WELCOME', 'POSTS WELCOME'],
  ['Post us your [ideas]{colour}', 'Post us your [posts]{colour}'],
  ['A parcel idea for us?', 'A parcel post for us?'],
  ['Ideas for beans', 'Posts for beans'],
  ['Suggest post ideas…', 'Suggest posts…'],
  ['Post ideas for the team', 'Posts for the team'],
  ['Share a post idea', 'Share a post'],
  ['Good idea?', 'Have feedback?'],
  ['Got a good idea? Tell us', 'Got feedback? Tell us'],
  ['Thanks! Great ideas?', 'Thanks! Have feedback?'],
  ['Post your ideas', 'Share your posts'],
  ['Post an idea', 'Write a post'],
]

describe('posts wording', () => {
  it.each(GOLDEN)('writes %j as %j', (written, read) => {
    expect(postsWording(written, 'en')).toBe(read)
    expect(postsWording(written)).toBe(read)
  })

  it('never writes a post as "post posts"', () => {
    for (const [written] of GOLDEN)
      expect(postsWording(written)).not.toMatch(/\bposts?\s+posts?\b/i)
    expect(postsWording('Post ideas, post idea, POST IDEAS')).not.toMatch(/\bposts?\s+posts?\b/i)
  })

  it('leaves words that only look like it, and other languages, as written', () => {
    expect(postsWording('The ideal ideation', 'en')).toBe('The ideal ideation')
    expect(postsWording('Teilen Sie Ihre Idee', 'de')).toBe('Teilen Sie Ihre Idee')
    expect(postsWording('Comparte tu idea, an idea', 'es')).toBe('Comparte tu idea, an idea')
    expect(postsWording('Share your idea', 'en-GB')).toBe('Share your post')
  })

  it('sets every line visitors read, and nothing else', () => {
    const words: WordsAnswer = {
      evidence: 'They like ideas.',
      home_layout: 'portal',
      home_headline: 'Got an idea?',
      home_subtitle: 'Share ideas.',
      feedback_headline: 'Your ideas',
      feedback_subtitle: 'Vote on ideas.',
      prompt: 'An idea?',
      submit: 'Send the idea',
    }
    const read = postsInWords(words, 'en')
    expect(read.evidence).toBe('They like ideas.')
    expect(read.home_layout).toBe('portal')
    expect(WORD_LINES.map((line) => read[line])).toEqual([
      'Got feedback?',
      'Share posts.',
      'Your posts',
      'Vote on posts.',
      'A post?',
      'Send the post',
    ])
    expect(postsInWords(words, 'de')).toEqual(words)
  })

  it('reaches the words the portal is given', () => {
    const words = WORDS_EXAMPLES[0]!.answers.signature
    const idea = { ...words, home_headline: 'Got an idea?', submit: 'Send your idea' }
    const values = (language: string) =>
      Object.fromEntries(
        wordsChanges(idea, defaultDesign(), ON, language).map((c) => [c.path, c.value])
      )
    expect(values('en')['pages.home.headline.title']).toBe('Got feedback?')
    expect(values('en')['pages.feedback.copy.submit']).toBe('Send your post')
    expect(values('de')['pages.home.headline.title']).toBe('Got an idea?')
  })

  it('the few-shot examples never teach "idea"', () => {
    const lines = WORDS_EXAMPLES.flatMap((example) =>
      Object.values(example.answers).flatMap((a) => WORD_LINES.map((line) => a[line]))
    )
    expect(lines.filter((line) => /\bideas?\b/i.test(line))).toEqual([])
  })

  /**
   * "ideas" is the stored key of the Top posts block, and the model must be
   * able to name it; everywhere else the guide, the examples and the hints
   * teach visitor copy, which says posts.
   */
  const withoutTheKey = (text: string) =>
    text.replace(/"ideas"|:ideas\b|\(ideas\)|\bideas \("Top posts"\)/g, '')
  const ideasIn = (text: string) =>
    [...withoutTheKey(text).matchAll(/.{0,30}\bideas?\b.{0,30}/gi)].map((m) => m[0])

  it('the design AI guide never teaches "idea"', () => {
    const prompt = opsPrompt({
      blockTypes: homeBlockTypes(ON),
      writesCss: true,
      places: { boards: [], roadmaps: [], categories: [] },
    })
    // The scan reaches the examples, where the stored key is named.
    expect(prompt).toContain('"target":"ideas"')
    expect(ideasIn(prompt)).toEqual([])
  })

  it('the override examples never teach "idea"', () => {
    expect(ideasIn(JSON.stringify(OVERRIDE_OPS_EXAMPLES))).toEqual([])
  })

  it('the words hints never teach "idea"', () => {
    // The hints are the lines lineLint returns, which the model is told to fix.
    // Its detectors may match "idea" in what the model wrote; its advice may not.
    const dir = path.resolve(__dirname, '..')
    const source = readFileSync(path.join(dir, 'words-evidence.ts'), 'utf8')
    const lint = source.slice(
      source.indexOf('export function lineLint'),
      source.indexOf('export function wordsLints')
    )
    const constants = (file: string) =>
      Object.fromEntries(
        [
          ...readFileSync(path.join(dir, file), 'utf8').matchAll(
            /^(?:export )?const ([A-Z_]+) =\s*'((?:[^'\\]|\\.)*)'/gm
          ),
        ].map((m) => [m[1], m[2]])
      )
    const named = { ...constants('words-evidence.ts'), ...constants('words-button.ts') }
    const hints = [
      ...[...lint.matchAll(/return '((?:[^'\\]|\\.)*)'/g)].map((m) => m[1]),
      ...[...lint.matchAll(/return ([A-Z_]+)\b/g)].map((m) => named[m[1]!]),
    ]
    // The scan must reach the hints it guards, named ones included.
    expect(hints.length).toBeGreaterThan(15)
    expect(hints).not.toContain(undefined)
    expect(hints.flatMap((hint) => ideasIn(hint!))).toEqual([])
  })
})
