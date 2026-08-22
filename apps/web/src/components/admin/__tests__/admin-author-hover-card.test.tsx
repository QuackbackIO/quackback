// @vitest-environment happy-dom
/**
 * AdminAuthorHoverCard — the lazy admin author hover card.
 *
 * Covers the data contract that matters:
 *   - Hovering fetches the public profile AND the people.view-gated team
 *     context on open (not on mount).
 *   - A null public profile shows no card body.
 *   - Team rows (company, last seen, segments with a +N cap) render from
 *     the team payload; clicking the trigger navigates to the admin profile.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import type { ReactElement } from 'react'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const navigate = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
}))

const getPublicUserProfileFn = vi.fn()
const getProfileTeamContextFn = vi.fn()
vi.mock('@/lib/server/functions/public-profile', () => ({
  getPublicUserProfileFn: (...args: unknown[]) => getPublicUserProfileFn(...args),
  getProfileTeamContextFn: (...args: unknown[]) => getProfileTeamContextFn(...args),
}))

import { AdminAuthorHoverCard } from '../admin-author-hover-card'

const PROFILE = {
  principalId: 'principal_abc',
  displayName: 'Ada Lovelace',
  avatarUrl: null,
  isTeamMember: false,
  joinedAt: '2024-03-01T00:00:00.000Z',
  postCount: 7,
  commentCount: 12,
  voteCount: 42,
  posts: [],
  comments: [],
  upvotes: [],
}

const TEAM = {
  email: 'ada@example.com',
  emailVerified: true,
  blocked: false,
  lastSeenAt: '2026-04-01T12:00:00.000Z',
  company: { id: 'company_1', name: 'Northwind', plan: 'Growth', mrrCents: 49900 },
  segments: [
    { id: 'segment_1', name: 'Beta cohort', color: '#a855f7' },
    { id: 'segment_2', name: 'High MRR', color: '#22c55e' },
  ],
}

function renderCard(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

beforeEach(() => {
  navigate.mockReset()
  getPublicUserProfileFn.mockReset()
  getProfileTeamContextFn.mockReset()
})
afterEach(cleanup)

describe('AdminAuthorHoverCard', () => {
  it('does not fetch on mount, only on open', () => {
    renderCard(
      <AdminAuthorHoverCard principalId="principal_abc" displayName="Ada Lovelace">
        Ada Lovelace
      </AdminAuthorHoverCard>
    )
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(getPublicUserProfileFn).not.toHaveBeenCalled()
    expect(getProfileTeamContextFn).not.toHaveBeenCalled()
  })

  it('opens on hover, fetches both payloads, and renders team rows + votes label', async () => {
    getPublicUserProfileFn.mockResolvedValue(PROFILE)
    getProfileTeamContextFn.mockResolvedValue(TEAM)
    renderCard(
      <AdminAuthorHoverCard principalId="principal_abc" displayName="Ada Lovelace">
        Ada Lovelace
      </AdminAuthorHoverCard>
    )

    fireEvent.mouseEnter(screen.getByText('Ada Lovelace'))

    await waitFor(() => expect(getPublicUserProfileFn).toHaveBeenCalledTimes(1))
    expect(getProfileTeamContextFn).toHaveBeenCalledWith({
      data: { principalId: 'principal_abc' },
    })

    const body = await screen.findByTestId('admin-author-hover-card-body')
    expect(body).toHaveTextContent('ada@example.com')
    expect(body).toHaveTextContent('Northwind')
    expect(body).toHaveTextContent('Growth')
    expect(body).toHaveTextContent('Beta cohort')
    expect(body).toHaveTextContent('High MRR')
    expect(body).toHaveTextContent('Votes')
    expect(body).toHaveTextContent('Open full profile')
    expect(body.querySelector('svg')) // verified icon
  })

  it('caps overflowing segments to one named chip plus a +N counter', async () => {
    getPublicUserProfileFn.mockResolvedValue(PROFILE)
    getProfileTeamContextFn.mockResolvedValue({
      ...TEAM,
      segments: [
        { id: 's1', name: 'Alpha', color: '#000' },
        { id: 's2', name: 'Beta', color: '#111' },
        { id: 's3', name: 'Gamma', color: '#222' },
        { id: 's4', name: 'Delta', color: '#333' },
      ],
    })
    renderCard(
      <AdminAuthorHoverCard principalId="principal_abc" displayName="Ada Lovelace">
        Ada Lovelace
      </AdminAuthorHoverCard>
    )
    fireEvent.mouseEnter(screen.getByText('Ada Lovelace'))
    const body = await screen.findByTestId('admin-author-hover-card-body')
    expect(body).toHaveTextContent('Alpha')
    expect(body).toHaveTextContent('+3')
    expect(body).not.toHaveTextContent('Beta')
  })

  it('shows a Blocked badge when the team payload says so', async () => {
    getPublicUserProfileFn.mockResolvedValue(PROFILE)
    getProfileTeamContextFn.mockResolvedValue({ ...TEAM, blocked: true })
    renderCard(
      <AdminAuthorHoverCard principalId="principal_abc" displayName="Ada Lovelace">
        Ada Lovelace
      </AdminAuthorHoverCard>
    )
    fireEvent.mouseEnter(screen.getByText('Ada Lovelace'))
    const body = await screen.findByTestId('admin-author-hover-card-body')
    expect(body).toHaveTextContent('Blocked')
  })

  it('shows no card body when the public profile resolves null', async () => {
    getPublicUserProfileFn.mockResolvedValue(null)
    getProfileTeamContextFn.mockResolvedValue(null)
    renderCard(
      <AdminAuthorHoverCard principalId="principal_ghost" displayName="Ghost">
        Ghost
      </AdminAuthorHoverCard>
    )

    fireEvent.mouseEnter(screen.getByText('Ghost'))
    await waitFor(() => expect(getPublicUserProfileFn).toHaveBeenCalledTimes(1))

    await waitFor(() =>
      expect(screen.queryByTestId('admin-author-hover-card-skeleton')).not.toBeInTheDocument()
    )
    expect(screen.queryByTestId('admin-author-hover-card-body')).not.toBeInTheDocument()
    expect(screen.getByText('Ghost')).toBeInTheDocument()
  })

  it('navigates to the admin profile on trigger click', async () => {
    getPublicUserProfileFn.mockResolvedValue(PROFILE)
    getProfileTeamContextFn.mockResolvedValue(TEAM)
    renderCard(
      <AdminAuthorHoverCard principalId="principal_abc" displayName="Ada Lovelace">
        Ada Lovelace
      </AdminAuthorHoverCard>
    )
    fireEvent.click(screen.getByText('Ada Lovelace'))
    expect(navigate).toHaveBeenCalledWith({
      to: '/admin/users',
      search: { selected: 'principal_abc' },
    })
  })
})
