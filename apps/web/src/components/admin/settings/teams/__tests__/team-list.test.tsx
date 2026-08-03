// @vitest-environment happy-dom
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { TeamId } from '@quackback/ids'
import { TeamList } from '../team-list'

type TeamRow = {
  id: TeamId
  name: string
  slug: string
  shortLabel: string | null
  color: string | null
  archivedAt: string | null
}

const mocks = vi.hoisted(() => ({
  teams: [] as TeamRow[],
}))

vi.mock('@tanstack/react-query', () => ({
  useSuspenseQuery: () => ({
    data: mocks.teams,
  }),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params,
  }: {
    children: ReactNode
    to: string
    params?: Record<string, string>
    className?: string
  }) => (
    <a
      href={Object.entries(params ?? {}).reduce(
        (path, [key, value]) => path.replace(`$${key}`, value),
        to
      )}
    >
      {children}
    </a>
  ),
}))

vi.mock('@/lib/client/queries/teams', () => ({
  teamQueries: {
    list: (params: unknown) => ({ queryKey: ['teams', params] }),
  },
}))

vi.mock('@/components/ui/table', () => ({
  Table: ({ children }: { children: ReactNode }) => <table>{children}</table>,
  TableBody: ({ children }: { children: ReactNode }) => <tbody>{children}</tbody>,
  TableCell: ({
    children,
    colSpan,
  }: {
    children?: ReactNode
    colSpan?: number
    className?: string
  }) => <td colSpan={colSpan}>{children}</td>,
  TableHead: ({ children }: { children?: ReactNode; className?: string }) => <th>{children}</th>,
  TableHeader: ({ children }: { children: ReactNode }) => <thead>{children}</thead>,
  TableRow: ({ children }: { children: ReactNode; className?: string }) => <tr>{children}</tr>,
}))

vi.mock('@/components/ui/switch', () => ({
  Switch: ({
    id,
    checked,
    onCheckedChange,
  }: {
    id?: string
    checked: boolean
    onCheckedChange: (checked: boolean) => void
  }) => (
    <input
      id={id}
      type="checkbox"
      checked={checked}
      onChange={(event) => onCheckedChange(event.currentTarget.checked)}
    />
  ),
}))

vi.mock('@/components/ui/label', () => ({
  Label: ({ children, htmlFor }: { children: ReactNode; htmlFor?: string; className?: string }) => (
    <label htmlFor={htmlFor}>{children}</label>
  ),
}))

vi.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: { children: ReactNode; variant?: string; className?: string }) => (
    <span>{children}</span>
  ),
}))

function team(overrides: Partial<TeamRow> = {}): TeamRow {
  return {
    id: 'team_1' as TeamId,
    name: 'Support',
    slug: 'support',
    shortLabel: 'SUP',
    color: '#2563eb',
    archivedAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  mocks.teams = [
    team(),
    team({
      id: 'team_archived' as TeamId,
      name: 'Legacy',
      slug: 'legacy',
      shortLabel: null,
      color: null,
      archivedAt: '2026-06-20T10:00:00.000Z',
    }),
  ]
})

describe('TeamList', () => {
  it('renders active teams by default and reveals archived teams', () => {
    render(<TeamList />)

    expect(screen.getByRole('link', { name: /Support/ })).toHaveAttribute(
      'href',
      '/admin/settings/teams/team_1'
    )
    expect(screen.getByText('support')).toBeInTheDocument()
    expect(screen.getByText('SUP')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(screen.queryByText('Legacy')).not.toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Show archived'))

    expect(screen.getByRole('link', { name: /Legacy/ })).toHaveAttribute(
      'href',
      '/admin/settings/teams/team_archived'
    )
    expect(screen.getByText('legacy')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByText('Archived')).toBeInTheDocument()
  })

  it('renders an empty state when there are no visible teams', () => {
    mocks.teams = []
    render(<TeamList />)

    expect(screen.getByText('No teams yet. Create your first team.')).toBeInTheDocument()
  })
})
