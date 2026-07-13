// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { WidgetSupportCard } from '../widget-support-card'

function renderCard(onOpen = vi.fn()) {
  return {
    onOpen,
    ...render(
      <IntlProvider locale="en" defaultLocale="en">
        <WidgetSupportCard onOpen={onOpen} />
      </IntlProvider>
    ),
  }
}

describe('WidgetSupportCard', () => {
  it('renders the title and description', () => {
    renderCard()
    expect(screen.getByText('Contact support')).toBeTruthy()
    expect(screen.getByText('Get help directly from our team.')).toBeTruthy()
  })

  it('invokes onOpen when clicked', () => {
    const { onOpen } = renderCard()
    fireEvent.click(screen.getByRole('button'))
    expect(onOpen).toHaveBeenCalledTimes(1)
  })
})
