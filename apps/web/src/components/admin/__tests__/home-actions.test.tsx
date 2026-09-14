// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('@/components/admin/feedback/create-post-dialog', () => ({
  CreatePostDialog: () => <div>create-post-dialog</div>,
}))
vi.mock('@/components/admin/changelog/create-changelog-dialog', () => ({
  CreateChangelogDialog: () => <div>create-changelog-dialog</div>,
}))
vi.mock('@/components/admin/help-center/create-article-dialog', () => ({
  CreateArticleDialog: () => <div>create-article-dialog</div>,
}))
vi.mock('@/components/admin/conversation/new-conversation-dialog', () => ({
  NewConversationDialog: () => <div>new-conversation-dialog</div>,
}))
vi.mock('@/components/admin/inbox/create-ticket-dialog', () => ({
  CreateTicketDialog: () => <div>create-ticket-dialog</div>,
}))
vi.mock('@/components/admin/status/status-report-incident-dialog', () => ({
  ReportIncidentDialog: () => <div>report-incident-dialog</div>,
}))
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: [] }),
}))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useRouteContext: () => ({
    user: { name: 'Ada', email: 'ada@example.com' },
    principal: { id: 'prin_1' },
  }),
}))

import { HomeActions } from '../home-actions'

const allOn = {
  feedback: true,
  changelog: true,
  supportInbox: true,
  supportTickets: true,
  helpCenter: true,
  statusPage: true,
}

describe('HomeActions', () => {
  it('lists create actions grouped by module', async () => {
    const user = userEvent.setup()
    render(<HomeActions flags={allOn} />)

    await user.click(screen.getByRole('button', { name: 'Actions' }))

    expect(screen.getByText('Feedback & Roadmaps')).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'New post' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'New changelog' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'New conversation' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'New ticket' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'New article' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Report incident' })).toBeInTheDocument()
  })

  it('opens the matching create dialog', async () => {
    const user = userEvent.setup()
    render(<HomeActions flags={{ feedback: true, changelog: true }} />)

    await user.click(screen.getByRole('button', { name: 'Actions' }))
    await user.click(screen.getByRole('menuitem', { name: 'New changelog' }))

    expect(await screen.findByText('create-changelog-dialog')).toBeInTheDocument()
  })
})
