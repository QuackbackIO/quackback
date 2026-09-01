// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', async () => {
  const actual =
    await vi.importActual<typeof import('@tanstack/react-router')>('@tanstack/react-router')
  return {
    ...actual,
    useRouter: () => ({ invalidate: vi.fn() }),
    Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
  }
})

vi.mock('@/lib/client/mutations/settings', () => ({
  useUpdateWidgetConfig: () => ({ mutateAsync: vi.fn() }),
}))

const { TabsCard, LayoutCard } = await import('../settings.widget')

const config = {
  tabs: {
    home: true,
    messenger: true,
    tickets: true,
    feedback: true,
    changelog: true,
    help: true,
  },
}

function renderTabs(
  flags: {
    helpCenterFlagEnabled?: boolean
    supportInboxFlagEnabled?: boolean
    feedbackFlagEnabled?: boolean
    changelogFlagEnabled?: boolean
    supportTicketsFlagEnabled?: boolean
  } = {}
) {
  return render(
    <TabsCard
      config={config}
      boards={[]}
      helpCenterFlagEnabled={flags.helpCenterFlagEnabled ?? false}
      supportInboxFlagEnabled={flags.supportInboxFlagEnabled ?? true}
      feedbackFlagEnabled={flags.feedbackFlagEnabled ?? true}
      changelogFlagEnabled={flags.changelogFlagEnabled ?? true}
      supportTicketsFlagEnabled={flags.supportTicketsFlagEnabled ?? false}
    />
  )
}

describe('Widget Tabs card', () => {
  it('lists Messages, Feedback, and Changelog when Support Inbox and those products are on', () => {
    renderTabs()
    expect(screen.getByRole('switch', { name: 'Messages tab' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Feedback tab' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Changelog tab' })).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Tickets tab' })).not.toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Help tab' })).not.toBeInTheDocument()
  })

  it('hides Messages when Support Inbox is off', () => {
    renderTabs({ supportInboxFlagEnabled: false })
    expect(screen.queryByRole('switch', { name: 'Messages tab' })).not.toBeInTheDocument()
  })

  it('shows Tickets only while the tickets product is on', () => {
    renderTabs({ supportTicketsFlagEnabled: true })
    expect(screen.getByRole('switch', { name: 'Tickets tab' })).toBeInTheDocument()
  })

  it('hides Changelog when that product is off', () => {
    renderTabs({ changelogFlagEnabled: false })
    expect(screen.getByRole('switch', { name: 'Feedback tab' })).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Changelog tab' })).not.toBeInTheDocument()
  })

  it('shows Help only while the help product is on', () => {
    renderTabs({ helpCenterFlagEnabled: true })
    expect(screen.getByRole('switch', { name: 'Help tab' })).toBeInTheDocument()
  })

  it('keeps launcher chrome out of the Tabs card', () => {
    renderTabs()
    expect(screen.queryByLabelText('Launcher greeting')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Button label')).not.toBeInTheDocument()
  })
})

describe('Widget Layout card', () => {
  it('exposes launcher chrome fields separately from the Home greeting', () => {
    render(
      <LayoutCard
        config={{}}
        position="bottom-right"
        onPositionChange={vi.fn()}
        launcherLabel=""
        onLabelChange={vi.fn()}
        launcherGreeting=""
        onGreetingChange={vi.fn()}
      />
    )
    expect(screen.getByLabelText('Launcher greeting')).toBeInTheDocument()
    expect(screen.getByLabelText('Button label')).toBeInTheDocument()
    expect(screen.getByText('Button position')).toBeInTheDocument()
  })
})
