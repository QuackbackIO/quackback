// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import type { ComponentProps } from 'react'
import { WidgetHelp } from '../widget-help'

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: [],
    isLoading: false,
  }),
}))

vi.mock('@/lib/client/queries/help-center', () => ({
  publicHelpCenterQueries: {
    categories: () => ({ queryKey: ['help-center', 'public-categories'] }),
  },
}))

vi.mock('../widget-messages-section', () => ({
  WidgetMessagesSection: () => null,
}))

function renderHelp(props: Partial<ComponentProps<typeof WidgetHelp>> = {}) {
  return render(
    <IntlProvider locale="en" defaultLocale="en">
      <WidgetHelp {...props} />
    </IntlProvider>
  )
}

describe('WidgetHelp', () => {
  it('renders the support ticket card in the default support view', () => {
    const onOpenSupport = vi.fn()
    renderHelp({ onOpenSupport })

    fireEvent.click(screen.getByRole('button', { name: /Contact support/i }))

    expect(onOpenSupport).toHaveBeenCalledTimes(1)
  })

  it('does not render the support ticket card while searching', () => {
    renderHelp({ onOpenSupport: vi.fn() })

    fireEvent.change(screen.getByPlaceholderText('Search help articles...'), {
      target: { value: 'billing' },
    })

    expect(screen.queryByRole('button', { name: /Contact support/i })).toBeNull()
  })
})
