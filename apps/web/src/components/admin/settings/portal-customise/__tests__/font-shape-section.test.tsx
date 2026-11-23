// @vitest-environment happy-dom
/**
 * Font and shape: the text font, the headings font beside it ("Same as text"
 * until one is chosen), and how cards stand off the page, as three tiles.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/server/functions/uploads', () => ({ getFontUploadUrlFn: vi.fn() }))
vi.mock('@/lib/client/storage-upload', () => ({ putStorageUpload: vi.fn() }))

const { FontShapeSection, fontFamilyName } = await import('../font-shape-section')

const INTER = '"Inter Variable", "Inter", ui-sans-serif, system-ui, sans-serif'
const MANROPE = '"Manrope", ui-sans-serif, system-ui, sans-serif'
const display = {
  family: 'Northwind Display',
  fallback: 'inter' as const,
  files: [{ key: 'fonts/2026/11/h-600.woff2', weight: 600, style: 'normal' as const }],
}

function renderSection(props: Partial<Parameters<typeof FontShapeSection>[0]> = {}) {
  const handlers = {
    setFont: vi.fn(),
    setRadius: vi.fn(),
    setButtonShape: vi.fn(),
    setUploadedFont: vi.fn(),
    setHeadingFont: vi.fn(),
    setUploadedHeadingFont: vi.fn(),
    setCardStyle: vi.fn(),
  }
  render(
    <FontShapeSection
      font={INTER}
      headingFont={null}
      cardStyle="border"
      radius={0.5}
      buttonShape="pill"
      {...handlers}
      {...props}
    />
  )
  return handlers
}

afterEach(cleanup)

describe('Headings', () => {
  it('sits beside the text font and reads Same as text until one is chosen', () => {
    renderSection()
    expect(screen.getByRole('combobox', { name: 'Text' })).toHaveTextContent('Inter')
    expect(screen.getByRole('combobox', { name: 'Headings' })).toHaveTextContent('Same as text')
  })

  it('names a listed font, a font outside the list, and an uploaded family', () => {
    renderSection({ headingFont: MANROPE })
    expect(screen.getByRole('combobox', { name: 'Headings' })).toHaveTextContent('Manrope')
    cleanup()
    renderSection({ headingFont: 'MonzoSansDisplay, sans-serif' })
    expect(screen.getByRole('combobox', { name: 'Headings' })).toHaveTextContent(
      'Monzo Sans Display, your current font'
    )
    cleanup()
    renderSection({ customHeadingFont: display })
    expect(screen.getByRole('combobox', { name: 'Headings' })).toHaveTextContent(
      'Northwind Display, uploaded'
    )
    // Its faces are written, so its name shows in itself.
    expect(document.querySelector('style')?.textContent).toContain(
      '@font-face { font-family: "Northwind Display"'
    )
  })

  it('offers an upload of its own, which asks for no fallback: headings fall back to the text font', () => {
    renderSection()
    fireEvent.click(screen.getByRole('button', { name: 'Upload a headings font' }))
    expect(screen.getByRole('dialog', { name: 'Upload a headings font' })).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
    expect(screen.queryByLabelText('Fallback')).toBeNull()
  })

  it('picks a listed font, and goes back to the text font', async () => {
    const { setHeadingFont } = renderSection({ headingFont: MANROPE })
    const user = userEvent.setup()
    await user.click(screen.getByRole('combobox', { name: 'Headings' }))
    await user.click(await screen.findByRole('option', { name: 'Same as text' }))
    expect(setHeadingFont).toHaveBeenCalledWith(null)
  })
})

describe('font names', () => {
  it('reads a family with no spaces as words', () => {
    expect(fontFamilyName('MonzoSansText, sans-serif')).toBe('Monzo Sans Text')
    expect(fontFamilyName('"Plus Jakarta Sans", sans-serif')).toBe('Plus Jakarta Sans')
    expect(fontFamilyName('')).toBe('System UI')
  })

  it('shows an uploaded text family as words too', () => {
    renderSection({ customFont: { ...display, family: 'MonzoSansText' } })
    expect(screen.getByRole('combobox', { name: 'Text' })).toHaveTextContent(
      'Monzo Sans Text, uploaded'
    )
  })
})

describe('Cards', () => {
  it('offers Border, Shadow and Flat as radios, the current one checked', () => {
    renderSection({ cardStyle: 'shadow' })
    const group = screen.getByRole('radiogroup', { name: 'Cards' })
    const radios = [...group.querySelectorAll('[role="radio"]')]
    expect(radios.map((radio) => radio.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
    ])
    for (const label of ['Border', 'Shadow', 'Flat']) expect(screen.getByText(label)).toBeTruthy()
  })

  it('sets the style a tile names', async () => {
    const { setCardStyle } = renderSection()
    const user = userEvent.setup()
    await user.click(screen.getByText('Shadow'))
    await user.click(screen.getByText('Flat'))
    expect(setCardStyle.mock.calls).toEqual([['shadow'], ['flat']])
  })

  it('leaves Corners and Buttons as they were', () => {
    const { setRadius } = renderSection()
    fireEvent.click(screen.getByRole('radio', { name: 'Sharp' }))
    expect(setRadius).toHaveBeenCalledWith(0)
  })
})
