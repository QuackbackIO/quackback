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

const { ModulesCard } = await import('../settings.widget')

const config = {
  tabs: { home: true, messenger: true, feedback: true, changelog: true, help: true },
}

function renderModules(
  flags: {
    helpCenterFlagEnabled?: boolean
    supportInboxFlagEnabled?: boolean
    feedbackFlagEnabled?: boolean
    changelogFlagEnabled?: boolean
    supportTicketsFlagEnabled?: boolean
  } = {}
) {
  return render(
    <ModulesCard
      config={config}
      boards={[]}
      position="bottom-right"
      onPositionChange={vi.fn()}
      launcherLabel=""
      onLabelChange={vi.fn()}
      helpCenterFlagEnabled={flags.helpCenterFlagEnabled ?? false}
      supportInboxFlagEnabled={flags.supportInboxFlagEnabled ?? true}
      feedbackFlagEnabled={flags.feedbackFlagEnabled ?? true}
      changelogFlagEnabled={flags.changelogFlagEnabled ?? true}
      supportTicketsFlagEnabled={flags.supportTicketsFlagEnabled ?? false}
    />
  )
}

describe('Widget Modules card', () => {
  it('has no Messages row and lists Feedback and Changelog when those products are on', () => {
    renderModules()
    expect(screen.queryByRole('switch', { name: 'Messages tab' })).not.toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Feedback tab' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Changelog tab' })).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Help tab' })).not.toBeInTheDocument()
  })

  it('hides Changelog when that product is off', () => {
    renderModules({ changelogFlagEnabled: false })
    expect(screen.getByRole('switch', { name: 'Feedback tab' })).toBeInTheDocument()
    expect(screen.queryByRole('switch', { name: 'Changelog tab' })).not.toBeInTheDocument()
  })

  it('shows Help only while the help product is on', () => {
    renderModules({ helpCenterFlagEnabled: true })
    expect(screen.getByRole('switch', { name: 'Help tab' })).toBeInTheDocument()
  })
})
