// @vitest-environment happy-dom
/**
 * The Colours section: four rows and no warnings, since whatever is picked
 * the portal's text is worked out to read.
 */
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { expandTheme, unbrandedTheme } from '@/lib/shared/theme/expand'
import { contrastRatio } from '@/lib/shared/theme/colour-setters'
import { ColoursSection } from '../colours-section'

afterEach(cleanup)

const light = { ...unbrandedTheme('light'), primary: '#533afd' }
const dark = { ...unbrandedTheme('dark'), primary: '#533afd' }

function renderSection(over: Partial<Parameters<typeof ColoursSection>[0]> = {}) {
  const setColour = vi.fn()
  const setThemeMode = vi.fn()
  render(
    <ColoursSection
      themeMode="light"
      light={light}
      dark={dark}
      setColour={setColour}
      setThemeMode={setThemeMode}
      {...over}
    />
  )
  return { setColour, setThemeMode }
}

describe('ColoursSection', () => {
  it('lists Main colour, Background and Text, Auto until set', () => {
    renderSection()
    expect(screen.getByRole('button', { name: /Main colour.*#533afd/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Background.*Auto/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Text.*Auto/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Header.*Auto/ })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows a header colour once set', () => {
    renderSection({ light: { ...light, header: '#005eb8' } })
    expect(screen.getByRole('button', { name: /Header.*#005eb8/ })).toBeInTheDocument()
  })

  it('never warns: a pale main colour or pale text is worked out to read on the portal', () => {
    renderSection({ light: { ...light, primary: '#ffd43b' } })
    expect(screen.queryByRole('alert')).toBeNull()
    cleanup()
    renderSection({ light: { ...light, foreground: '#bbbbbb' } })
    expect(screen.queryByRole('alert')).toBeNull()
    const portal = expandTheme(
      { ...light, primary: '#ffd43b', foreground: '#bbbbbb' },
      { mode: 'light' }
    )
    expect(contrastRatio(portal.primaryInk!, portal.background!)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(portal.foreground!, portal.background!)).toBeGreaterThanOrEqual(4.5)
  })

  it('works dark colours out until the admin asks to change them', () => {
    renderSection({ themeMode: 'user' })
    expect(screen.getByText(/Dark mode colours are worked out for you/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Main colour/ })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Change' }))
    expect(screen.getAllByRole('button', { name: /Main colour/ })).toHaveLength(2)
  })

  it('shows the dark rows alone for an always dark portal', () => {
    renderSection({ themeMode: 'dark' })
    expect(screen.getAllByRole('button', { name: /Main colour/ })).toHaveLength(1)
    expect(screen.queryByText(/worked out for you/)).toBeNull()
  })
})
