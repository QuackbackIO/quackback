// @vitest-environment happy-dom
/**
 * The Colours section: four rows, a warning only when something fails, and
 * a Fix that writes the corrected colour.
 */
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { unbrandedTheme } from '@/lib/shared/theme'
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

  it('warns about hard to read links and fixes them', () => {
    const { setColour } = renderSection({ light: { ...light, primary: '#ffd43b' } })
    const warning = screen.getByRole('alert')
    expect(warning).toHaveTextContent('Links are hard to read on this background.')
    fireEvent.click(within(warning).getByRole('button', { name: 'Fix' }))
    const [role, mode, hex] = setColour.mock.calls[0]!
    expect([role, mode]).toEqual(['primary', 'light'])
    expect(contrastRatio(hex, '#ffffff')).toBeGreaterThanOrEqual(3)
  })

  it('warns about hard to read text and puts it back on Auto', () => {
    const { setColour } = renderSection({ light: { ...light, foreground: '#bbbbbb' } })
    const warning = screen.getByRole('alert')
    expect(warning).toHaveTextContent('Text is hard to read on this background.')
    fireEvent.click(within(warning).getByRole('button', { name: 'Fix' }))
    expect(setColour).toHaveBeenCalledWith('foreground', 'light', null)
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
