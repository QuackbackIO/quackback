// @vitest-environment happy-dom
/**
 * AuthorHoverCard — the lazy portal author hover card.
 *
 * Covers the data contract that matters:
 *   - Hovering the trigger fetches the profile ON OPEN (not on mount) and
 *     renders the payload (name, member-since, counts).
 *   - A null payload (anonymous / not visible) shows no card body — the
 *     plain trigger text stays and nothing else renders.
 *
 * The router and the profile server fn are mocked so the test focuses on the
 * component's open→fetch→render wiring without a real router or network.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import type { ReactElement } from 'react'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'

// ---- Mocks -----------------------------------------------------------

const navigate = vi.fn()
let routeContext: unknown = {
  settings: {
    name: 'Acme',
    brandingData: { logoUrl: null, name: 'Acme' },
  },
}
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useRouteContext: () => routeContext,
}))

const getPublicUserProfileFn = vi.fn()
vi.mock('@/lib/server/functions/public-profile', () => ({
  getPublicUserProfileFn: (...args: unknown[]) => getPublicUserProfileFn(...args),
}))

import { AuthorHoverCard } from '../author-hover-card'

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

function renderCard(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <IntlProvider locale="en" messages={{}} onError={() => {}}>
        {ui}
      </IntlProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  navigate.mockReset()
  getPublicUserProfileFn.mockReset()
  routeContext = {
    settings: {
      name: 'Acme',
      brandingData: { logoUrl: null, name: 'Acme' },
    },
  }
})
afterEach(cleanup)

describe('AuthorHoverCard', () => {
  it('does not fetch on mount, only on open', () => {
    renderCard(
      <AuthorHoverCard principalId="principal_abc" displayName="Ada Lovelace">
        Ada Lovelace
      </AuthorHoverCard>
    )
    // Trigger text is present, but nothing has been fetched yet.
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument()
    expect(getPublicUserProfileFn).not.toHaveBeenCalled()
  })

  it('opens on hover, fetches, and renders the payload', async () => {
    getPublicUserProfileFn.mockResolvedValue(PROFILE)
    renderCard(
      <AuthorHoverCard principalId="principal_abc" displayName="Ada Lovelace">
        Ada Lovelace
      </AuthorHoverCard>
    )

    fireEvent.mouseEnter(screen.getByText('Ada Lovelace'))

    // Fetches on open with the principal id.
    await waitFor(() => expect(getPublicUserProfileFn).toHaveBeenCalledTimes(1))
    expect(getPublicUserProfileFn).toHaveBeenCalledWith({ data: { principalId: 'principal_abc' } })

    // Card body renders the fetched counts.
    const body = await screen.findByTestId('author-hover-card-body')
    expect(body).toBeInTheDocument()
    expect(body).toHaveTextContent('7')
    expect(body).toHaveTextContent('12')
    expect(body).toHaveTextContent('42')
  })

  it('shows no card body when the payload resolves null', async () => {
    getPublicUserProfileFn.mockResolvedValue(null)
    renderCard(
      <AuthorHoverCard principalId="principal_ghost" displayName="Ghost">
        Ghost
      </AuthorHoverCard>
    )

    fireEvent.mouseEnter(screen.getByText('Ghost'))
    await waitFor(() => expect(getPublicUserProfileFn).toHaveBeenCalledTimes(1))

    // A null payload never surfaces a card body or a lingering skeleton.
    await waitFor(() =>
      expect(screen.queryByTestId('author-hover-card-skeleton')).not.toBeInTheDocument()
    )
    expect(screen.queryByTestId('author-hover-card-body')).not.toBeInTheDocument()
    // Plain trigger text remains.
    expect(screen.getByText('Ghost')).toBeInTheDocument()
  })
})
