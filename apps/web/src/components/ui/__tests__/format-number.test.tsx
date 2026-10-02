// @vitest-environment happy-dom
import { render, screen, cleanup } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { afterEach, describe, expect, it } from 'vitest'
import { restoreRuntimeLocale, setRuntimeLocale } from '@/test/runtime-locale'
import { useFormatNumber } from '../format-number'

afterEach(() => {
  cleanup()
  restoreRuntimeLocale()
})

function Probe({ value, options }: { value: number; options?: Intl.NumberFormatOptions }) {
  return <span data-testid="n">{useFormatNumber()(value, options)}</span>
}

describe('useFormatNumber', () => {
  it("formats in the IntlProvider's locale, not the runtime's", () => {
    setRuntimeLocale('en-US', 'UTC')
    render(
      <IntlProvider locale="de" defaultLocale="en">
        <Probe value={12345.5} />
      </IntlProvider>
    )
    expect(screen.getByTestId('n').textContent).toBe('12.345,5')
  })

  it('passes number options through', () => {
    render(
      <IntlProvider locale="en" defaultLocale="en">
        <Probe value={0.256} options={{ style: 'percent' }} />
      </IntlProvider>
    )
    expect(screen.getByTestId('n').textContent).toBe('26%')
  })

  it('formats in the default locale outside a provider', () => {
    setRuntimeLocale('de-DE', 'UTC')
    render(<Probe value={12345} />)
    expect(screen.getByTestId('n').textContent).toBe('12,345')
  })
})
