// @vitest-environment happy-dom
/**
 * <BoardModerationForm> — R4 per-board moderation overrides.
 *
 * Covers:
 *   - Renders all three rule rows
 *   - Inheritance banner reflects override state
 *   - Inherit sub-pill mirrors the workspace default ("none" → Off,
 *     "all" → On, axis-aware mapping otherwise)
 *   - Switching a rule from Inherit to On dirties the form
 *   - Save submits a payload that overwrites only the moderation slice
 *     and preserves the rest of `board.access` verbatim
 *   - Discard restores the original moderation
 *
 * The mutation and portalConfig queries are mocked. portalConfig is
 * mutable so tests can flip workspace defaults between renders.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BoardModerationForm } from '../board-moderation-form'
import { DEFAULT_BOARD_ACCESS, type BoardAccess } from '@/lib/shared/db-types'
import type { BoardId } from '@quackback/ids'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    children,
    className,
  }: {
    to: string
    children: React.ReactNode
    className?: string
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}))

const mutate = vi.fn()
vi.mock('@/lib/client/mutations', () => ({
  useUpdateBoardAccess: () => ({
    mutate,
    isPending: false,
    isError: false,
    error: null,
  }),
}))

const wsFlagsState = {
  requireApproval: 'none' as 'none' | 'anonymous' | 'authenticated' | 'all',
}
function setWsFlags(next: Partial<typeof wsFlagsState>) {
  Object.assign(wsFlagsState, next)
}

vi.mock('@/lib/client/queries/settings', () => ({
  settingsQueries: {
    portalConfig: () => ({
      queryKey: ['settings', 'portalConfig'],
      queryFn: async () => ({
        features: {
          allowAnonymous: true,
          allowEditAfterEngagement: false,
          allowDeleteAfterEngagement: false,
          showPublicEditHistory: false,
        },
        moderationDefault: { requireApproval: wsFlagsState.requireApproval },
        oauth: {},
        access: {
          visibility: 'public' as const,
          allowedDomains: [],
          widgetSignIn: false,
          allowedSegmentIds: [],
        },
      }),
    }),
  },
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BOARD_ID = 'brd_test' as BoardId

const MOD_RULE_LABELS = {
  anonPosts: 'Require approval for anonymous posts',
  signedPosts: 'Require approval for signed-in posts',
  comments: 'Require approval for new comments',
} as const

/** Default-public BoardAccess matching the new "Public" preset. */
const PUBLIC_ACCESS: BoardAccess = {
  view: 'anonymous',
  vote: 'authenticated',
  comment: 'authenticated',
  submit: 'authenticated',
  segments: { view: [], vote: [], comment: [], submit: [] },
  moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
}

function renderForm(access: BoardAccess = DEFAULT_BOARD_ACCESS) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <BoardModerationForm board={{ id: BOARD_ID, access }} />
    </QueryClientProvider>
  )
}

beforeEach(() => {
  mutate.mockReset()
  setWsFlags({ requireApproval: 'none' })
})

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

describe('<BoardModerationForm> rendering', () => {
  it('renders the three rule rows', () => {
    renderForm(PUBLIC_ACCESS)
    expect(screen.getByText(MOD_RULE_LABELS.anonPosts)).toBeInTheDocument()
    expect(screen.getByText(MOD_RULE_LABELS.signedPosts)).toBeInTheDocument()
    expect(screen.getByText(MOD_RULE_LABELS.comments)).toBeInTheDocument()
  })

  it('renders the "inheriting" banner when every rule is inherit', () => {
    renderForm(PUBLIC_ACCESS)
    expect(screen.getByText(/inheriting all workspace defaults/i)).toBeInTheDocument()
    expect(screen.queryByText(/overrides/i)).not.toBeInTheDocument()
  })

  it('renders the "overrides" banner + Override badge when a rule is set', () => {
    renderForm({
      ...PUBLIC_ACCESS,
      moderation: { anonPosts: 'on', signedPosts: 'inherit', comments: 'inherit' },
    })
    expect(screen.getByText('Override')).toBeInTheDocument()
    const banners = screen.getAllByText(
      (_, el) =>
        el?.tagName === 'DIV' &&
        !!el.textContent &&
        /overrides some workspace defaults/i.test(el.textContent)
    )
    expect(banners.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Inheritance pill
// ---------------------------------------------------------------------------

describe('<BoardModerationForm> inheritance pill', () => {
  it('Inherit sub-pill reflects workspace default ("none" → all Off)', async () => {
    setWsFlags({ requireApproval: 'none' })
    renderForm(PUBLIC_ACCESS)
    await waitFor(() => {
      const anonInherit = screen.getByRole('radio', {
        name: `${MOD_RULE_LABELS.anonPosts}: Inherit`,
      })
      expect(anonInherit.textContent).toMatch(/Off/)
    })
    expect(
      screen.getByRole('radio', { name: `${MOD_RULE_LABELS.signedPosts}: Inherit` }).textContent
    ).toMatch(/Off/)
    expect(
      screen.getByRole('radio', { name: `${MOD_RULE_LABELS.comments}: Inherit` }).textContent
    ).toMatch(/Off/)
  })

  it('Inherit sub-pill reflects workspace default ("all" → all On)', async () => {
    setWsFlags({ requireApproval: 'all' })
    renderForm(PUBLIC_ACCESS)
    await waitFor(() => {
      const anonInherit = screen.getByRole('radio', {
        name: `${MOD_RULE_LABELS.anonPosts}: Inherit`,
      })
      expect(anonInherit.textContent).toMatch(/On/)
    })
    expect(
      screen.getByRole('radio', { name: `${MOD_RULE_LABELS.signedPosts}: Inherit` }).textContent
    ).toMatch(/On/)
    expect(
      screen.getByRole('radio', { name: `${MOD_RULE_LABELS.comments}: Inherit` }).textContent
    ).toMatch(/On/)
  })
})

// ---------------------------------------------------------------------------
// Dirty / Save / Discard
// ---------------------------------------------------------------------------

describe('<BoardModerationForm> save', () => {
  it('Save dock is collapsed until form is dirty', () => {
    renderForm(PUBLIC_ACCESS)
    const region = screen.getByRole('region', { name: /save changes/i })
    expect(region.getAttribute('data-dirty')).toBeNull()
  })

  it('switching Inherit → On dirties the form', () => {
    renderForm(PUBLIC_ACCESS)
    fireEvent.click(screen.getByRole('radio', { name: `${MOD_RULE_LABELS.anonPosts}: On` }))
    const region = screen.getByRole('region', { name: /save changes/i })
    expect(region.getAttribute('data-dirty')).toBe('true')
  })

  it('submits a payload that overwrites only moderation and preserves the rest of access', async () => {
    // Non-default access shape — we expect every field to round-trip
    // through the save payload unchanged.
    const access: BoardAccess = {
      view: 'anonymous',
      vote: 'segments',
      comment: 'team',
      submit: 'authenticated',
      segments: {
        view: [],
        vote: ['seg_alpha'],
        comment: [],
        submit: [],
      },
      moderation: { anonPosts: 'inherit', signedPosts: 'inherit', comments: 'inherit' },
    }
    renderForm(access)

    fireEvent.click(screen.getByRole('radio', { name: `${MOD_RULE_LABELS.anonPosts}: On` }))
    fireEvent.click(screen.getByRole('radio', { name: `${MOD_RULE_LABELS.comments}: Off` }))
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith({
        boardId: BOARD_ID,
        access: {
          // Access slice — must round-trip verbatim, including segments.
          view: 'anonymous',
          vote: 'segments',
          comment: 'team',
          submit: 'authenticated',
          segments: {
            view: [],
            vote: ['seg_alpha'],
            comment: [],
            submit: [],
          },
          // Only moderation changed.
          moderation: { anonPosts: 'on', signedPosts: 'inherit', comments: 'off' },
        },
      })
    )
  })

  it('Discard restores the original moderation', () => {
    renderForm(PUBLIC_ACCESS)
    fireEvent.click(screen.getByRole('radio', { name: `${MOD_RULE_LABELS.anonPosts}: On` }))
    // Override badge surfaces on dirty
    expect(screen.getByText('Override')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /discard/i }))
    // Override badge gone; dock collapses.
    expect(screen.queryByText('Override')).not.toBeInTheDocument()
    const region = screen.getByRole('region', { name: /save changes/i })
    expect(region.getAttribute('data-dirty')).toBeNull()
  })
})
