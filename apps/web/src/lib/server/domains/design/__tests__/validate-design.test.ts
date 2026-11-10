/**
 * A design taken in, from the designer, the AI or the API, may still hold the
 * words designs once chose; it saves without them. Any other unknown key is
 * still refused.
 */
import { describe, expect, it } from 'vitest'
import { defaultDesign } from '@/lib/shared/design/schema'
import { asFormat2 } from '@/lib/shared/design/__tests__/format2'
import {
  MAX_DESIGN_BYTES,
  MAX_WELCOME_CHARACTERS,
  MAX_WELCOME_NODES,
  validateDesign,
} from '../validate-design'
import { refusable } from '../design.actions'
import { isValidWords } from '@/lib/shared/design/words-schema'

describe('validateDesign', () => {
  it('takes a design that still has its words, without them', () => {
    const doc = asFormat2({
      ...defaultDesign(),
      vocabulary: { post: 'suggestion', board: 'category' },
    })
    const valid = validateDesign(doc)
    expect(valid).not.toHaveProperty('vocabulary')
    expect(valid).toEqual(defaultDesign())
  })

  it('takes a design written in format 2, with the hero’s keys named for the band', () => {
    const doc = defaultDesign()
    doc.layout.hero = 'brand'
    doc.layout.heroShape = 'inset'
    expect(validateDesign(asFormat2(doc))).toEqual(doc)
  })

  it('refuses any other key it does not know', () => {
    expect(() => validateDesign({ ...defaultDesign(), future: { on: true } })).toThrow()
  })
})

describe('validateDesign: Welcome words', () => {
  const para = (...content: object[]) => ({ type: 'paragraph', content })
  const withBody = (body: object) => {
    const design = defaultDesign()
    design.pages.feedback.welcome = { show: true, body: body as never }
    return design
  }

  it('fits words the schema refuses before they are kept', () => {
    const body = {
      type: 'doc',
      content: [
        para({
          type: 'text',
          text: 'run me',
          marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
        }),
        { type: 'heading', attrs: { level: 2, textAlign: 'justify' }, content: [] },
      ],
    }
    const saved = validateDesign(withBody(body)).pages.feedback.welcome.body
    expect(isValidWords(saved, 'rich')).toBe(true)
    expect(saved).toEqual({
      type: 'doc',
      content: [para({ type: 'text', text: 'run me' }), { type: 'heading', attrs: { level: 2 } }],
    })
  })

  it('keeps words the schema holds as they are', () => {
    const body = {
      type: 'doc',
      content: [para({ type: 'text', text: 'Hi', marks: [{ type: 'bold' }] })],
    }
    expect(validateDesign(withBody(body)).pages.feedback.welcome.body).toEqual(body)
  })

  it('keeps a body written with the full editor, for the panel', () => {
    const body = {
      type: 'doc',
      content: [
        { type: 'image', attrs: { src: 'https://cdn.example/a.png' } },
        para({ type: 'text', text: 'x' }),
      ],
    }
    expect(validateDesign(withBody(body)).pages.feedback.welcome.body).toEqual(body)
  })
})

describe('validateDesign: size', () => {
  const para = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] })
  const doc = (...content: object[]) => ({ type: 'doc', content })
  const withWelcome = (body: object) => {
    const design = defaultDesign()
    design.pages.feedback.welcome = { show: true, body: body as never }
    return design
  }
  const withHomeWelcome = (body: object) => {
    const design = defaultDesign()
    design.pages.home.blocks = [
      { id: 'welcome001', type: 'welcome', body: body as never, grid: { x: 0, y: 0, w: 12, h: 1 } },
    ]
    return design
  }
  const refusalOf = (input: unknown) =>
    refusable(async () => validateDesign(input)).then((result) =>
      'ok' in result && result.ok === false ? result : null
    )

  it('takes a design at the largest the schema allows for its CSS', () => {
    const design = defaultDesign()
    design.css = `.a{color:red}\n`.repeat(3_000).slice(0, 50_000)
    expect(() => validateDesign(design)).not.toThrow()
  })

  /** A design the schema takes, made heavy with a prompt in `count` made-up languages. */
  const withPrompts = (count: number, text: string) => {
    const design = defaultDesign()
    design.pages.feedback.copy.prompt = Object.fromEntries(
      Array.from({ length: count }, (_, i) => [`x-${i}`, text])
    )
    return design
  }

  it('refuses a design heavier than its budget, as a refusal a person can act on', async () => {
    const design = withPrompts(5_000, 'a'.repeat(60))
    expect(JSON.stringify(design).length).toBeGreaterThan(MAX_DESIGN_BYTES)
    expect(await refusalOf(design)).toMatchObject({
      code: 'DESIGN_TOO_LARGE',
      message: 'This design is too large to save.',
    })
  })

  it('counts the budget in bytes, not characters', async () => {
    // Two bytes each in UTF-8: under the budget in characters, over it in bytes.
    const design = withPrompts(2_500, 'é'.repeat(60))
    expect(JSON.stringify(design).length).toBeLessThan(MAX_DESIGN_BYTES)
    expect((await refusalOf(design))?.code).toBe('DESIGN_TOO_LARGE')
    expect(() => validateDesign(withPrompts(1_000, 'é'.repeat(60)))).not.toThrow()
  })

  it('takes a Welcome message of a page of text', () => {
    const body = doc(para('a'.repeat(MAX_WELCOME_CHARACTERS)))
    expect(validateDesign(withWelcome(body)).pages.feedback.welcome.body).toEqual(body)
  })

  it('refuses a Welcome message with too much text', async () => {
    const body = doc(para('a'.repeat(MAX_WELCOME_CHARACTERS)), para('b'))
    expect(await refusalOf(withWelcome(body))).toMatchObject({
      code: 'WELCOME_TOO_LONG',
      message: 'This Welcome message is too long.',
    })
  })

  it('refuses a Welcome message with too many parts', async () => {
    const body = doc(...Array.from({ length: MAX_WELCOME_NODES }, () => para('a')))
    expect((await refusalOf(withWelcome(body)))?.code).toBe('WELCOME_TOO_LONG')
  })

  it('refuses a Welcome block on Home with too much text', async () => {
    const body = doc(para('a'.repeat(MAX_WELCOME_CHARACTERS + 1)))
    expect((await refusalOf(withHomeWelcome(body)))?.code).toBe('WELCOME_TOO_LONG')
    expect(() => validateDesign(withHomeWelcome(doc(para('Hi'))))).not.toThrow()
  })
})
