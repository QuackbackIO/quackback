// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import type { ComponentProps } from 'react'
import { WidgetOverview } from '../widget-overview'

vi.mock('../widget-auth-provider', () => ({
  useWidgetAuth: () => ({ user: null }),
}))

vi.mock('../use-chat-summary', () => ({
  useChatSummary: () => ({
    conversation: null,
    teamName: '',
    agentsOnline: false,
  }),
}))

vi.mock('../widget-changelog-teaser', () => ({
  WidgetChangelogTeaser: () => null,
}))

function renderOverview(props: Partial<ComponentProps<typeof WidgetOverview>> = {}) {
  const defaults: ComponentProps<typeof WidgetOverview> = {
    tabs: { feedback: true, help: true },
    onLeaveFeedback: vi.fn(),
    onGetHelp: vi.fn(),
    onResumeChat: vi.fn(),
    onSeeChangelog: vi.fn(),
    onOpenChangelogEntry: vi.fn(),
  }

  return render(
    <IntlProvider locale="en" defaultLocale="en">
      <WidgetOverview {...defaults} {...props} />
    </IntlProvider>
  )
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('WidgetOverview', () => {
  it('does not render the ticket action unless onOpenSupport is provided', () => {
    renderOverview()

    expect(screen.queryByRole('button', { name: /Contact support/i })).toBeNull()
  })

  it('renders and opens the support ticket action when provided', () => {
    const onOpenSupport = vi.fn()
    renderOverview({ onOpenSupport })

    fireEvent.click(screen.getByRole('button', { name: /Contact support/i }))

    expect(onOpenSupport).toHaveBeenCalledTimes(1)
  })
})
