import { describe, expect, it } from 'vitest'
import { defaultDesign, portalDesign } from '../schema'
import {
  headlineOf,
  readWordsField,
  setHeadlineAccent,
  setHeadlineWords,
  setWords,
  wordsByLanguage,
  wordsDocOf,
  wordsElsewhere,
  wordsKindOf,
  wordsLimitOf,
  wordsName,
} from '../headline-words'
import { docText, plainDoc } from '../rich-words'
import { newBlock } from '../home'

describe('readWordsField', () => {
  it('reads a page and part, and nothing else', () => {
    expect(readWordsField('home.title')).toEqual({ kind: 'page', page: 'home', part: 'title' })
    expect(readWordsField('roadmap.subtitle')).toEqual({
      kind: 'page',
      page: 'roadmap',
      part: 'subtitle',
    })
    expect(readWordsField('block-linksblock1.heading')).toEqual({
      kind: 'block',
      id: 'linksblock1',
    })
    for (const field of [
      'status.title',
      'home.body',
      'home.title.x',
      'home',
      42,
      '__proto__.title',
    ])
      expect(readWordsField(field)).toBeNull()
  })
})

describe('setHeadlineWords', () => {
  it("writes Home's headline in one language and keeps the others", () => {
    const design = defaultDesign()
    setHeadlineWords(design, 'home', 'title', 'en', 'Hello')
    setHeadlineWords(design, 'home', 'title', 'de', 'Hallo')
    setHeadlineWords(design, 'home', 'title', 'en', '')
    expect(design.pages.home.headline).toEqual({ title: { de: 'Hallo' }, subtitle: {} })
  })

  it('leaves a page on its usual words once every language is emptied', () => {
    const design = defaultDesign()
    setHeadlineWords(design, 'feedback', 'subtitle', 'en', 'Tell us')
    setHeadlineWords(design, 'feedback', 'subtitle', 'en', '')
    expect(design.pages.feedback.headline).toBeNull()
    setHeadlineWords(design, 'changelog', 'title', 'fr', 'Nouveautés')
    expect(design.pages.titles).toEqual({
      changelog: { title: { fr: 'Nouveautés' }, subtitle: {} },
    })
    setHeadlineWords(design, 'changelog', 'title', 'fr', '')
    expect(design.pages.titles).toBeUndefined()
  })
})

describe('setHeadlineAccent', () => {
  it('sets a phrase apart on any worded page, and drops it once emptied', () => {
    const design = defaultDesign()
    setHeadlineAccent(design, 'roadmap', 'en', 'next')
    expect(design.pages.titles).toBeUndefined()
    setHeadlineWords(design, 'roadmap', 'title', 'en', 'What is next')
    setHeadlineAccent(design, 'roadmap', 'en', 'next')
    expect(headlineOf(design, 'roadmap')?.accent).toEqual({ style: 'colour', text: { en: 'next' } })
    setHeadlineAccent(design, 'roadmap', 'en', '')
    expect(headlineOf(design, 'roadmap')?.accent).toBeUndefined()
  })
})

describe('setWords', () => {
  it("writes a Home block's heading by its id, and drops it once emptied", () => {
    const design = defaultDesign()
    design.pages.home.blocks = [{ ...newBlock('links'), id: 'linksblock1' }]
    setWords(design, { kind: 'block', id: 'linksblock1' }, 'de', 'Anderswo')
    expect(design.pages.home.blocks[0]!.heading).toEqual({ de: 'Anderswo' })
    setWords(design, { kind: 'block', id: 'linksblock1' }, 'de', '')
    expect(design.pages.home.blocks[0]!.heading).toBeUndefined()
    setWords(design, { kind: 'block', id: 'missing00' }, 'de', 'x')
    setWords(design, { kind: 'page', page: 'home', part: 'title' }, 'en', 'Hi')
    expect(design.pages.home.headline?.title).toEqual({ en: 'Hi' })
  })
})

describe('the hero call to action’s words', () => {
  it('reads its two marks as plain words by language', () => {
    expect(readWordsField('home.button')).toEqual({ kind: 'button', part: 'label' })
    expect(readWordsField('home.secondButton')).toEqual({ kind: 'button', part: 'secondLabel' })
    expect(readWordsField('feedback.button')).toBeNull()
    const field = { kind: 'button', part: 'label' } as const
    expect(wordsKindOf(field)).toBe('plain')
    expect(wordsLimitOf(field)).toBe(40)
    expect(wordsByLanguage(field)).toBe(true)
    expect(wordsName(field)).toBe('Button')
    expect(wordsName({ kind: 'button', part: 'secondLabel' })).toBe('Second button')
  })

  it('writes each in one language, keeping where it goes, and drops them once emptied', () => {
    const design = defaultDesign()
    design.pages.home.button = { to: 'roadmap' }
    setWords(design, { kind: 'button', part: 'label' }, 'en', 'See what is next')
    setWords(design, { kind: 'button', part: 'secondLabel' }, 'fr', 'Une idée')
    expect(design.pages.home.button).toEqual({
      to: 'roadmap',
      label: { en: 'See what is next' },
      secondLabel: { fr: 'Une idée' },
    })
    expect(wordsDocOf(design, { kind: 'button', part: 'label' }, 'en')).toEqual(
      plainDoc('See what is next')
    )
    expect(wordsElsewhere(design, { kind: 'button', part: 'secondLabel' }, 'en')).toEqual([
      { locale: 'fr', text: 'Une idée' },
    ])
    setWords(design, { kind: 'button', part: 'label' }, 'en', 'x'.repeat(60))
    expect(design.pages.home.button?.label?.en).toHaveLength(40)
    setWords(design, { kind: 'button', part: 'label' }, 'en', '')
    setWords(design, { kind: 'button', part: 'secondLabel' }, 'fr', '')
    expect(design.pages.home.button).toEqual({ to: 'roadmap' })
    design.pages.home.button = {}
    setWords(design, { kind: 'button', part: 'label' }, 'en', '')
    expect(design.pages.home).not.toHaveProperty('button')
  })
})

describe("a block's own plain words", () => {
  it('reads the link, line and empty message marks', () => {
    expect(readWordsField('block-ideasblock1.link')).toEqual({
      kind: 'block',
      id: 'ideasblock1',
      part: 'link',
    })
    expect(readWordsField('block-contactbl1.text')).toEqual({
      kind: 'block',
      id: 'contactbl1',
      part: 'text',
    })
    expect(readWordsField('block-ideasblock1.empty')).toEqual({
      kind: 'block',
      id: 'ideasblock1',
      part: 'empty',
    })
    expect(readWordsField('block-ideasblock1.other')).toBeNull()
  })

  it('edits them as plain words in each language, each within its own length', () => {
    const link = { kind: 'block', id: 'x', part: 'link' } as const
    const text = { kind: 'block', id: 'x', part: 'text' } as const
    const empty = { kind: 'block', id: 'x', part: 'empty' } as const
    expect([wordsKindOf(link), wordsKindOf(text), wordsKindOf(empty)]).toEqual([
      'plain',
      'plain',
      'plain',
    ])
    expect([wordsLimitOf(link), wordsLimitOf(text), wordsLimitOf(empty)]).toEqual([40, 160, 80])
    expect([wordsName(link), wordsName(text), wordsName(empty)]).toEqual([
      'Link',
      'Words',
      'Message when empty',
    ])
  })

  it('writes and reads them by language, and drops them once emptied', () => {
    const design = defaultDesign()
    design.pages.home.blocks = [
      { ...newBlock('ideas'), id: 'ideasblock1' },
      { ...newBlock('contact'), id: 'contactbl1' },
    ]
    const link = { kind: 'block', id: 'ideasblock1', part: 'link' } as const
    setWords(design, link, 'en', 'Every idea')
    setWords(design, link, 'de', 'Alle Ideen')
    setWords(design, { kind: 'block', id: 'ideasblock1', part: 'empty' }, 'en', 'Nothing yet')
    setWords(design, { kind: 'block', id: 'contactbl1', part: 'text' }, 'en', 'Write to us')
    setWords(design, { kind: 'block', id: 'contactbl1', part: 'link' }, 'en', 'Write')
    expect(design.pages.home.blocks[0]).toMatchObject({
      link: { en: 'Every idea', de: 'Alle Ideen' },
      emptyText: { en: 'Nothing yet' },
    })
    expect(design.pages.home.blocks[1]).toMatchObject({
      text: { en: 'Write to us' },
      link: { en: 'Write' },
    })
    expect(docText(wordsDocOf(design, link, 'de'))).toBe('Alle Ideen')
    expect(wordsElsewhere(design, link, 'en')).toEqual([{ locale: 'de', text: 'Alle Ideen' }])
    expect(portalDesign.safeParse(design).success).toBe(true)
    setWords(design, link, 'en', '')
    setWords(design, link, 'de', '')
    expect(design.pages.home.blocks[0]).not.toHaveProperty('link')
  })

  it('never writes a part a block does not have', () => {
    const design = defaultDesign()
    design.pages.home.blocks = [{ ...newBlock('links'), id: 'linksblock1' }]
    setWords(design, { kind: 'block', id: 'linksblock1', part: 'link' }, 'en', 'More')
    setWords(design, { kind: 'block', id: 'linksblock1', part: 'empty' }, 'en', 'None')
    expect(design.pages.home.blocks[0]).not.toHaveProperty('link')
    expect(design.pages.home.blocks[0]).not.toHaveProperty('emptyText')
  })
})

describe('the composer’s and the empty feed’s words', () => {
  it('reads their marks as plain words by language, each within its own length', () => {
    expect(readWordsField('feedback.prompt')).toEqual({ kind: 'feed', part: 'prompt' })
    expect(readWordsField('feedback.submit')).toEqual({ kind: 'feed', part: 'submit' })
    expect(readWordsField('feedback.emptyTitle')).toEqual({ kind: 'feed', part: 'emptyTitle' })
    expect(readWordsField('feedback.other')).toBeNull()
    const prompt = readWordsField('feedback.prompt')!
    const submit = readWordsField('feedback.submit')!
    expect(wordsKindOf(prompt)).toBe('plain')
    expect(wordsByLanguage(prompt)).toBe(true)
    expect(wordsLimitOf(prompt)).toBe(60)
    expect(wordsLimitOf(submit)).toBe(24)
    expect(wordsLimitOf(readWordsField('feedback.emptyTitle')!)).toBe(60)
    expect(wordsName(prompt)).toBe('Composer prompt')
    expect(wordsName(submit)).toBe('Composer button')
    expect(wordsName(readWordsField('feedback.emptyTitle')!)).toBe('Empty feed title')
  })

  it('writes each in one language where the design keeps them, and drops them once emptied', () => {
    const draft = defaultDesign()
    const prompt = readWordsField('feedback.prompt')!
    const submit = readWordsField('feedback.submit')!
    setWords(draft, prompt, 'en', 'Tell us what would help')
    setWords(draft, prompt, 'fr', 'Dites-nous')
    setWords(draft, submit, 'en', 'A very long button label that runs on')
    expect(draft.pages.feedback.copy.prompt).toEqual({
      en: 'Tell us what would help',
      fr: 'Dites-nous',
    })
    expect(draft.pages.feedback.copy.submit).toEqual({ en: 'A very long button label' })
    expect(docText(wordsDocOf(draft, prompt, 'fr'))).toBe('Dites-nous')
    expect(wordsElsewhere(draft, prompt, 'en')).toEqual([{ locale: 'fr', text: 'Dites-nous' }])
    setWords(draft, prompt, 'en', '')
    setWords(draft, prompt, 'fr', '')
    setWords(draft, submit, 'en', '')
    expect(draft.pages.feedback.copy).toEqual({})
    expect(portalDesign.safeParse(draft).success).toBe(true)
  })
})
