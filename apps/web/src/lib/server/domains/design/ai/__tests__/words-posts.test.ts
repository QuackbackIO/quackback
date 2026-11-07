import { describe, expect, it } from 'vitest'
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
  ['Got an idea for your deliveries?', 'Got a post for your deliveries?'],
  ['An idea for the roadmap', 'A post for the roadmap'],
  ['Vote for the ideas you like', 'Vote for the posts you like'],
  ['IDEAS WELCOME', 'POSTS WELCOME'],
  ['Post us your [ideas]{colour}', 'Post us your [posts]{colour}'],
  ['A parcel idea for us?', 'A parcel post for us?'],
  ['Ideas for beans', 'Posts for beans'],
]

describe('posts wording', () => {
  it.each(GOLDEN)('writes %j as %j', (written, read) => {
    expect(postsWording(written, 'en')).toBe(read)
    expect(postsWording(written)).toBe(read)
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
      'Got a post?',
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
    expect(values('en')['pages.home.headline.title']).toBe('Got a post?')
    expect(values('en')['pages.feedback.copy.submit']).toBe('Send your post')
    expect(values('de')['pages.home.headline.title']).toBe('Got an idea?')
  })

  it('the few-shot examples never teach "idea"', () => {
    const lines = WORDS_EXAMPLES.flatMap((example) =>
      Object.values(example.answers).flatMap((a) => WORD_LINES.map((line) => a[line]))
    )
    expect(lines.filter((line) => /\bideas?\b/i.test(line))).toEqual([])
  })
})
