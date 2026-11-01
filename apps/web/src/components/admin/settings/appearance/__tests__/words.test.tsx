// @vitest-environment happy-dom
/**
 * Brand › Words sets what visitors call what they post and what groups it.
 * After a change it finds the menu labels and English headlines that still
 * name the old word and offers to reword them, keeping each one's capitals,
 * in the same draft.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { defaultDesign, portalDesign, type PortalDesign } from '@/lib/shared/design/schema'
vi.mock('@/components/ui/select', async () => import('@/test/radix-select'))

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

  it('writes the workspace’s own wording per language, and clears it', async () => {
    const seen = renderWords(defaultDesign())
    const prompt = () => screen.getByRole('textbox', { name: 'Composer prompt' })
    expect(prompt().getAttribute('placeholder')).toBe("What's your idea?")
    fireEvent.change(prompt(), { target: { value: 'Tell us anything' } })
    expect(seen.design.pages.feedback.copy).toEqual({ prompt: { en: 'Tell us anything' } })

    await chooseLanguage('Own wording language', 'German')
    expect((prompt() as HTMLInputElement).value).toBe('')
    expect(prompt().getAttribute('placeholder')).toBe('The German translation')
    fireEvent.change(prompt(), { target: { value: 'Erzähl uns alles' } })
    expect(seen.design.pages.feedback.copy.prompt).toEqual({
      en: 'Tell us anything',
      de: 'Erzähl uns alles',
    })

    fireEvent.change(prompt(), { target: { value: '' } })
    await chooseLanguage('Own wording language', 'English')
    fireEvent.change(prompt(), { target: { value: ' ' } })
    expect(seen.design.pages.feedback.copy).toEqual({})
    expect(portalDesign.safeParse(seen.design).success).toBe(true)
  })
})

/** Picks a language from a Language picker by its name. */
async function chooseLanguage(picker: string, language: string) {
  const select = screen.getByRole('combobox', { name: picker }) as HTMLSelectElement
  const option = [...select.options].find((each) => each.textContent === language)!
  await act(async () => fireEvent.change(select, { target: { value: option.value } }))
}
