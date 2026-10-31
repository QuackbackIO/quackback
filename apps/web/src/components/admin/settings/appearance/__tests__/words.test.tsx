// @vitest-environment happy-dom
/**
 * Brand › Words sets what visitors call what they post and what groups it.
 * After a change it finds the menu labels and English headlines that still
 * name the old word and offers to reword them, keeping each one's capitals,
 * in the same draft.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { defaultDesign, portalDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { oldWordUses } from '../words'
import { WordsSection } from '../words-section'

function withOldWords() {
  const doc = defaultDesign()
  doc.nav.items = [
    { type: 'feedback', shown: true, label: 'Ideas' },
    { type: 'roadmap', shown: true },
  ]
  doc.pages.feedback.headline = {
    title: { en: 'Share your ideas', fr: 'Partagez vos idées' },
    subtitle: { en: 'Vote on an idea, or add your own' },
  }
  return doc
}

describe('oldWordUses', () => {
  it('rewords menu labels and English headlines, keeping their capitals', () => {
    const uses = oldWordUses(withOldWords(), 'idea', 'suggestion')
    expect(uses.map(({ where, before, after }) => [where, before, after])).toEqual([
      ['Menu', 'Ideas', 'Suggestions'],
      ['Headline', 'Share your ideas', 'Share your suggestions'],
      ['Headline', 'Vote on an idea, or add your own', 'Vote on a suggestion, or add your own'],
    ])
  })

  it('puts an before a word that starts with a vowel', () => {
    const doc = defaultDesign()
    doc.nav.items = [{ type: 'feedback', shown: true, label: 'A post a day' }]
    expect(oldWordUses(doc, 'post', 'idea')[0]?.after).toBe('An idea a day')
  })

  it('finds nothing for the same word, or a word only inside another', () => {
    expect(oldWordUses(withOldWords(), 'idea', 'idea')).toEqual([])
    const doc = defaultDesign()
    doc.nav.items = [{ type: 'feedback', shown: true, label: 'Dashboard' }]
    expect(oldWordUses(doc, 'board', 'category')).toEqual([])
  })
})

function renderWords(start: PortalDesign) {
  const seen = { design: start }
  function Harness() {
    const [design, setDesign] = useState(start)
    return (
      <WordsSection
        design={design}
        update={(change) => {
          const next = structuredClone(design)
          change(next)
          seen.design = next
          setDesign(next)
        }}
      />
    )
  }
  render(<Harness />)
  return seen
}

afterEach(cleanup)

describe('Brand › Words', () => {
  it('sets the words, then offers to reword what still names the old one', () => {
    const seen = renderWords(withOldWords())
    expect(screen.queryByText(/still say/)).toBeNull()
    fireEvent.click(screen.getByRole('radio', { name: 'Suggestion' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Category' }))
    expect(seen.design.vocabulary).toEqual({ post: 'suggestion', board: 'category' })
    expect(screen.getByText('Your menu and headlines still say ideas.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Update them' }))
    expect(seen.design.nav.items[0]).toMatchObject({ label: 'Suggestions' })
    expect(seen.design.pages.feedback.headline?.title).toEqual({
      en: 'Share your suggestions',
      fr: 'Partagez vos idées',
    })
    expect(screen.queryByText(/still say/)).toBeNull()
    expect(portalDesign.safeParse(seen.design).success).toBe(true)
  })

  it('leaves the labels as they are when the person keeps them', () => {
    const seen = renderWords(withOldWords())
    fireEvent.click(screen.getByRole('radio', { name: 'Post' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep them' }))
    expect(seen.design.nav.items[0]).toMatchObject({ label: 'Ideas' })
    expect(screen.queryByText(/still say/)).toBeNull()
  })

  it('offers nothing once the word is back where it started', () => {
    renderWords(withOldWords())
    fireEvent.click(screen.getByRole('radio', { name: 'Post' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Idea' }))
    expect(screen.queryByText(/still say/)).toBeNull()
  })
})
