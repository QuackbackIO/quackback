// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

let overview: unknown

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: overview, isLoading: false }),
}))
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))
vi.mock('@/routes/admin/status', () => ({
  Route: { fullPath: '/admin/status', useSearch: () => ({}) },
}))
vi.mock('@/lib/client/queries/status', () => ({
  statusOverviewQueries: { get: () => ({ queryKey: ['overview'] }) },
}))
vi.mock('@/lib/client/mutations/status', () => ({
  useStartStatusMaintenanceNow: () => ({ mutate: vi.fn(), isPending: false }),
}))
vi.mock('../status-report-incident-dialog', () => ({
  ReportIncidentDialog: () => <button>Report incident</button>,
}))
vi.mock('../status-schedule-maintenance-dialog', () => ({
  ScheduleMaintenanceDialog: () => <button>Schedule maintenance</button>,
}))

import { StatusOverviewView } from '../status-overview-view'

function makeOverview(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    topLevelStatus: 'operational',
    activeIncidents: [],
    upcomingMaintenance: [],
    ungroupedComponents: [{ id: 'c1', name: 'Website', status: 'operational' }],
    groups: [],
    uptime90d: 99.5,
    subscribers: { active: 4, newLast7d: 0 },
    incidentsLast30d: 0,
    ...overrides,
  }
}

describe('<StatusOverviewView>', () => {
  beforeEach(() => {
    overview = makeOverview()
  })

  it('renders the standard page header with its actions', () => {
    const { container } = render(<StatusOverviewView />)
    expect(container.querySelector('[data-page-header] h1')?.textContent).toBe('Overview')
    const header = container.querySelector('[data-page-header]') as HTMLElement
    expect(header.textContent).toContain('View public page')
    expect(header.textContent).toContain('Settings')
    expect(header.textContent).toContain('Schedule maintenance')
    expect(header.textContent).toContain('Report incident')
  })

  it('links the public page and the settings from the header', () => {
    render(<StatusOverviewView />)
    expect(screen.getByRole('link', { name: /View public page/ }).getAttribute('href')).toBe(
      '/status'
    )
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe(
      '/admin/settings/status'
    )
  })

  it('uses the glossary empty copy and a sentence-case banner label', () => {
    render(<StatusOverviewView />)
    expect(screen.getAllByText('No open incidents').length).toBeGreaterThan(0)
    expect(screen.queryByText(/All clear/)).toBeNull()
    const label = screen.getByText('Visitors currently see')
    expect(label.className).not.toContain('uppercase')
  })

  it('hides service groups that have no services', () => {
    overview = makeOverview({
      groups: [
        { id: 'g1', name: 'Infrastructure', components: [] },
        { id: 'g2', name: 'Apps', components: [{ id: 'c2', name: 'API', status: 'operational' }] },
      ],
    })
    render(<StatusOverviewView />)
    expect(screen.queryByText('Infrastructure')).toBeNull()
    expect(screen.getByText('Apps')).toBeTruthy()
  })

  it('shows the stats as sentence-case tiles', () => {
    render(<StatusOverviewView />)
    const label = screen.getByText('90-day uptime')
    expect(label.className).not.toContain('uppercase')
    expect(screen.getByText('99.50%')).toBeTruthy()
  })
})
