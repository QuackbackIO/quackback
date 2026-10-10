// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { ReactNode } from 'react'
import type { IntegrationCatalogEntry } from '@/lib/shared/integration-types'

vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock('../platform-credentials-dialog', () => ({
  PlatformCredentialsDialog: ({ integrationName }: { integrationName: string }) => (
    <p>Credentials for {integrationName}</p>
  ),
}))

const { IntegrationList } = await import('../integration-list')

afterEach(cleanup)

function entry(over: Partial<IntegrationCatalogEntry>): IntegrationCatalogEntry {
  return {
    id: 'slack',
    name: 'Slack',
    description: '',
    category: 'notifications',
    iconBg: 'bg-purple-600',
    settingsPath: '/admin/settings/integrations/slack',
    available: true,
    configurable: false,
    ...over,
  }
}

const catalog = [
  entry({}),
  entry({ id: 'linear', name: 'Linear', category: 'issue_tracking', settingsPath: '/x/linear' }),
  entry({
    id: 'jira',
    name: 'Jira',
    category: 'issue_tracking',
    available: false,
    configurable: true,
    settingsPath: '/x/jira',
  }),
]

describe('IntegrationList', () => {
  it('filters with a chip row of sentence-case categories instead of a sidebar', () => {
    render(<IntegrationList catalog={catalog} integrations={[]} />)
    const chips = screen.getByRole('group', { name: 'Categories' })
    expect(within(chips).getByRole('button', { name: 'All 3' })).toBeInTheDocument()
    fireEvent.click(within(chips).getByRole('button', { name: 'Issue tracking 2' }))
    expect(screen.queryByText('Slack')).toBeNull()
    expect(screen.getByText('Linear')).toBeInTheDocument()
    expect(screen.getByText('Jira')).toBeInTheDocument()
  })

  it('never labels a tile "Not configured" and opens credentials for an unconfigured one', async () => {
    render(<IntegrationList catalog={catalog} integrations={[]} />)
    expect(screen.queryByText('Not configured')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Jira/ }))
    expect(await screen.findByText('Credentials for Jira')).toBeInTheDocument()
  })

  it('badges only a connected integration, as Connected', () => {
    render(
      <IntegrationList catalog={catalog} integrations={[{ id: 'linear', status: 'active' }]} />
    )
    expect(screen.getAllByText('Connected')).toHaveLength(1)
    expect(screen.queryByText('Enabled')).toBeNull()
  })

  it('badges a paused integration Off and a failing one Error', () => {
    render(
      <IntegrationList
        catalog={catalog}
        integrations={[
          { id: 'linear', status: 'paused' },
          { id: 'slack', status: 'error' },
        ]}
      />
    )
    expect(screen.getByText('Off')).toBeInTheDocument()
    expect(screen.getByText('Error')).toBeInTheDocument()
  })

  it('uses one tile style: no dashed borders', () => {
    const { container } = render(<IntegrationList catalog={catalog} integrations={[]} />)
    expect(container.innerHTML).not.toContain('border-dashed')
  })
})
