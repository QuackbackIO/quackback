// @vitest-environment happy-dom
/**
 * Brand › Words writes the composer's prompt, its button and the empty feed's
 * title in the workspace's own words, per language, and clears them.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { defaultDesign, portalDesign, type PortalDesign } from '@/lib/shared/design/schema'
vi.mock('@/components/ui/select', async () => import('@/test/radix-select'))

import { WordsSection } from '../words-section'

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
  it('writes the workspace’s own wording per language, and clears it', async () => {
    const seen = renderWords(defaultDesign())
    const prompt = () => screen.getByRole('textbox', { name: 'Composer prompt' })
    expect(prompt().getAttribute('placeholder')).toBe("What's on your mind?")
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
