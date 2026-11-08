/**
 * A design taken in, from the designer, the AI or the API, may still hold the
 * words designs once chose; it saves without them. Any other unknown key is
 * still refused.
 */
import { describe, expect, it } from 'vitest'
import { defaultDesign } from '@/lib/shared/design/schema'
import { asFormat2 } from '@/lib/shared/design/__tests__/format2'
import { validateDesign } from '../validate-design'
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
