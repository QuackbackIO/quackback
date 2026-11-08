import { describe, expect, it } from 'vitest'
import type { PrincipalId } from '@quackback/ids'
import { authorKey, currentAuthors, recordAuthors } from '../draft-authors'

const ana = 'principal_ana' as PrincipalId
const bo = 'principal_bo' as PrincipalId

describe('draft authors', () => {
  it('marks what each save changed with who saved it, the newest author last', () => {
    const live = { layout: { cards: 'bordered', width: 'default' } }
    const first = { layout: { cards: 'raised', width: 'default' } }
    const second = { layout: { cards: 'list', width: 'wide' } }
    let authors = recordAuthors(null, live, first, authorKey(ana))
    authors = recordAuthors(authors, first, second, authorKey(bo, 'ai'))
    expect(authors).toEqual({
      'layout.cards': 'ai:principal_bo',
      'layout.width': 'ai:principal_bo',
    })
  })

  it('keeps an author only while the draft still makes that change', () => {
    const live = { layout: { cards: 'bordered', width: 'default' } }
    const authors = { 'layout.cards': authorKey(ana), 'layout.width': authorKey(bo) }
    const draft = { layout: { cards: 'raised', width: 'default' } }
    expect(currentAuthors(authors, live, draft)).toEqual({ 'layout.cards': 'principal_ana' })
    expect(currentAuthors(null, live, draft)).toEqual({})
  })
  it('finds the author a draft saved before format 3 marked by the hero key’s band name', () => {
    const live = { layout: { hero: 'none', heroShape: 'full' } }
    const draft = { layout: { hero: 'brand', heroShape: 'full' } }
    const authors = { 'layout.band': authorKey(ana) }
    expect(currentAuthors(authors, live, draft)).toEqual({ 'layout.hero': 'principal_ana' })
  })
})
