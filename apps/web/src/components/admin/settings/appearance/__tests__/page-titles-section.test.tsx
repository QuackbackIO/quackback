// @vitest-environment happy-dom
/**
 * Appearance words each page's title and puts the titles on the band. A page
 * whose words are cleared goes back to its usual title.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { useState } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { defaultDesign, type PortalDesign } from '@/lib/shared/design/schema'
import { PageTitlesSection } from '../page-titles-section'

const GATES = {
  feedback: true,
  roadmap: true,
  changelog: true,
  help: false,
  support: true,
  status: true,
}

let latest: PortalDesign

function Harness() {
  const [design, setDesign] = useState(defaultDesign())
  latest = design
  return (
    <PageTitlesSection
      design={design}
      gates={GATES}
      update={(change) =>
        setDesign((current) => {
          const draft = structuredClone(current)
          change(draft)
          return draft
        })
      }
    />
  )
}

afterEach(cleanup)

describe('Appearance’s page titles', () => {
  it('words the first shown page, and gives it back its usual title when cleared', () => {
    render(<Harness />)
    const title = screen.getByLabelText('Title')
    fireEvent.change(title, { target: { value: 'What we are building' } })
    expect(latest.pages.titles?.roadmap?.title).toEqual({ en: 'What we are building' })
    fireEvent.change(title, { target: { value: '' } })
    expect(latest.pages.titles).toBeUndefined()
  })

  it('puts the titles on the band', () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('radio', { name: /On the band/ }))
    expect(latest.layout.pageTitles).toBe('band')
  })
})
