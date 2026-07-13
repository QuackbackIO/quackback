// @vitest-environment happy-dom
import type { ComponentProps } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ApiKeyDetailPanel } from '../api-key-detail-panel'

type ApiKeyProp = ComponentProps<typeof ApiKeyDetailPanel>['apiKey']

const mocks = vi.hoisted(() => ({
  teams: [] as Array<{ id: string; name: string }>,
  inboxes: [] as Array<{ id: string; name: string }>,
}))

vi.mock('date-fns', () => ({
  formatDistanceToNow: (date: Date, options?: { addSuffix?: boolean }) =>
    `distance:${date.toISOString()}:${options?.addSuffix ? 'suffix' : 'plain'}`,
}))

vi.mock('@/lib/client/hooks/use-teams-queries', () => ({
  useTeams: () => ({
    data: mocks.teams,
  }),
}))

vi.mock('@/lib/client/hooks/use-inboxes-queries', () => ({
  useInboxes: () => ({
    data: mocks.inboxes,
  }),
}))

function apiKey(overrides: Partial<ApiKeyProp> = {}): ApiKeyProp {
  return {
    id: 'api_key_1',
    name: 'Primary key',
    keyPrefix: 'qb_live_123',
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    lastUsedAt: null,
    scopes: [],
    compatLegacyFullAccess: false,
    allowedTeamIds: [],
    allowedInboxIds: [],
    lastIp: null,
    rotatedAt: null,
    expiresAt: null,
    lastUserAgent: null,
    ...overrides,
  } as unknown as ApiKeyProp
}

beforeEach(() => {
  mocks.teams = []
  mocks.inboxes = []
})

describe('ApiKeyDetailPanel', () => {
  it('renders legacy full access, unrestricted teams and never-used metadata', () => {
    render(<ApiKeyDetailPanel apiKey={apiKey({ compatLegacyFullAccess: true })} />)

    expect(screen.getByText('Scopes')).toBeInTheDocument()
    expect(screen.getByText('All scopes (legacy)')).toBeInTheDocument()
    expect(screen.getByText('Any team')).toBeInTheDocument()
    expect(screen.getByText('Any inbox')).toBeInTheDocument()
    expect(screen.getAllByText('Never')).toHaveLength(2)
    expect(screen.getByText('distance:2026-06-01T00:00:00.000Z:suffix')).toBeInTheDocument()
  })

  it('renders scoped access with mapped and fallback team/inbox ids plus usage fields', () => {
    mocks.teams = [{ id: 'team_support', name: 'Support' }]
    mocks.inboxes = [{ id: 'inbox_support', name: 'Support inbox' }]

    render(
      <ApiKeyDetailPanel
        apiKey={apiKey({
          scopes: ['tickets:read', 'tickets:write'],
          allowedTeamIds: ['team_support', 'team_unknown'],
          allowedInboxIds: ['inbox_support', 'inbox_unknown'],
          lastUsedAt: new Date('2026-06-10T00:00:00.000Z'),
          lastIp: '203.0.113.10',
          rotatedAt: new Date('2026-06-11T00:00:00.000Z'),
          expiresAt: new Date('2026-07-01T00:00:00.000Z'),
          lastUserAgent: 'quackback-cli/1.0',
        })}
      />
    )

    expect(screen.getByText('tickets:read')).toBeInTheDocument()
    expect(screen.getByText('tickets:write')).toBeInTheDocument()
    expect(screen.getByText('Support')).toBeInTheDocument()
    expect(screen.getByText('team_unknown')).toBeInTheDocument()
    expect(screen.getByText('Support inbox')).toBeInTheDocument()
    expect(screen.getByText('inbox_unknown')).toBeInTheDocument()
    expect(screen.getByText('distance:2026-06-10T00:00:00.000Z:suffix')).toBeInTheDocument()
    expect(screen.getByText('203.0.113.10')).toBeInTheDocument()
    expect(screen.getByText('distance:2026-06-11T00:00:00.000Z:suffix')).toBeInTheDocument()
    expect(screen.getByText('distance:2026-07-01T00:00:00.000Z:suffix')).toBeInTheDocument()
    expect(screen.getByText('quackback-cli/1.0')).toHaveAttribute('title', 'quackback-cli/1.0')
  })

  it('renders explicit no-scope state without legacy full access', () => {
    render(<ApiKeyDetailPanel apiKey={apiKey()} />)

    expect(screen.getByText('No scopes')).toBeInTheDocument()
  })
})
