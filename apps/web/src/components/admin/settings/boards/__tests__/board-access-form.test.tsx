// @vitest-environment happy-dom
/**
 * <BoardAccessForm> — per-board access control with four audience kinds.
 *
 * Covers the visible behaviors of the form:
 *   - All four radios render
 *   - The board's current audience preselects the right radio (and
 *     segmentIds for a segments-audience board)
 *   - Save is disabled while 'Specific segments' is selected with zero
 *     segments ticked, and enabled the moment a segment is selected
 *   - Switching the radio AWAY from segments clears the form's
 *     segmentIds so a stale array can't sneak into the next submit
 *   - Each radio submits the right BoardAudience shape to the mutation
 *   - "Manage segments →" link is present + points at the People page
 *   - Empty-state nudge when no segments are configured at all
 *
 * The mutation hook and segments query are mocked so the tests are
 * pure component-level behavior; the real fetch is exercised by the
 * server-fn tests + the policy invariants.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BoardAccessForm } from '../board-access-form'
import type { BoardId } from '@quackback/ids'
import type { BoardAudience } from '@/lib/shared/db-types'

// ---------------------------------------------------------------------------
// Mocks — router Link, mutation hook, segments query
// ---------------------------------------------------------------------------

vi.mock('@tanstack/react-router', () => ({
  // The component renders <Link to="/admin/settings/people"> — render as
  // a plain <a> so we can assert its href without a real router.
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
const useUpdateBoardAccessSpy = vi.fn()
vi.mock('@/lib/client/mutations', () => ({
  useUpdateBoardAccess: () => useUpdateBoardAccessSpy(),
}))

const useSegmentsSpy = vi.fn()
vi.mock('@/lib/client/hooks/use-segments-queries', () => ({
  useSegments: () => useSegmentsSpy(),
}))

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BOARD_ID = 'brd_test' as BoardId

const SEGMENTS = [
  { id: 'seg_1', name: 'Active Users', memberCount: 27 },
  { id: 'seg_2', name: 'New Users', memberCount: 0 },
]

function renderForm(audience: BoardAudience, canEdit = true) {
  const qc = new QueryClient()
  return render(
    <QueryClientProvider client={qc}>
      <BoardAccessForm board={{ id: BOARD_ID, audience }} canEdit={canEdit} />
    </QueryClientProvider>
  )
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks()
  // Default: mutation idle, segments loaded with the fixture above.
  useUpdateBoardAccessSpy.mockReturnValue({
    mutate,
    isPending: false,
    isError: false,
    error: null,
  })
  useSegmentsSpy.mockReturnValue({
    data: SEGMENTS,
    isLoading: false,
    isError: false,
  })
})

// ---------------------------------------------------------------------------
// All four radios
// ---------------------------------------------------------------------------

describe('<BoardAccessForm> radios', () => {
  it('renders all four audience kinds as radio options', () => {
    renderForm({ kind: 'public' })
    expect(screen.getByText('Public')).toBeInTheDocument()
    expect(screen.getByText('Authenticated')).toBeInTheDocument()
    expect(screen.getByText('Team only')).toBeInTheDocument()
    expect(screen.getByText('Specific segments')).toBeInTheDocument()
    expect(screen.getAllByRole('radio')).toHaveLength(4)
  })

  it('preselects "Public" when the board audience is public', () => {
    renderForm({ kind: 'public' })
    const radios = screen.getAllByRole('radio')
    // Order: public, authenticated, team, segments
    expect(radios[0].getAttribute('data-state')).toBe('checked')
    expect(radios[1].getAttribute('data-state')).toBe('unchecked')
    expect(radios[2].getAttribute('data-state')).toBe('unchecked')
    expect(radios[3].getAttribute('data-state')).toBe('unchecked')
  })

  it('preselects "Authenticated" when the board audience is authenticated', () => {
    renderForm({ kind: 'authenticated' })
    const radios = screen.getAllByRole('radio')
    expect(radios[1].getAttribute('data-state')).toBe('checked')
  })

  it('preselects "Team only" when the board audience is team', () => {
    renderForm({ kind: 'team' })
    const radios = screen.getAllByRole('radio')
    expect(radios[2].getAttribute('data-state')).toBe('checked')
  })

  it('preselects "Specific segments" and reveals the multi-select when the board is on segments', () => {
    renderForm({ kind: 'segments', segmentIds: ['seg_1'] })
    const radios = screen.getAllByRole('radio')
    expect(radios[3].getAttribute('data-state')).toBe('checked')
    // Multi-select is now mounted
    expect(screen.getByRole('list', { name: /allowlist|allowed segments/i })).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Preselection of segmentIds
// ---------------------------------------------------------------------------

describe('<BoardAccessForm> segment preselection', () => {
  it('preselects the board’s existing segmentIds in the multi-select', () => {
    renderForm({ kind: 'segments', segmentIds: ['seg_1'] })
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes[0].checked).toBe(true) // Active Users (seg_1)
    expect(boxes[1].checked).toBe(false) // New Users (seg_2)
  })

  it('preselects multiple existing segmentIds', () => {
    renderForm({ kind: 'segments', segmentIds: ['seg_1', 'seg_2'] })
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes[0].checked).toBe(true)
    expect(boxes[1].checked).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Save button disabled state
// ---------------------------------------------------------------------------

describe('<BoardAccessForm> save button', () => {
  it('disables Save when "Specific segments" is selected with zero segments ticked', () => {
    renderForm({ kind: 'segments', segmentIds: [] })
    const save = screen.getByRole('button', { name: /save changes/i })
    expect(save).toBeDisabled()
  })

  it('shows the "Pick at least one segment to save." helper when zero are ticked', () => {
    renderForm({ kind: 'segments', segmentIds: [] })
    expect(screen.getByText(/pick at least one segment to save/i)).toBeInTheDocument()
  })

  it('enables Save the moment a segment is ticked', () => {
    renderForm({ kind: 'segments', segmentIds: [] })
    const save = screen.getByRole('button', { name: /save changes/i })
    expect(save).toBeDisabled()
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    expect(save).not.toBeDisabled()
    expect(screen.queryByText(/pick at least one segment/i)).toBeNull()
  })

  it('does not show the "pick at least one" helper when a non-segments radio is selected', () => {
    renderForm({ kind: 'public' })
    expect(screen.queryByText(/pick at least one segment/i)).toBeNull()
  })

  it('keeps Save enabled for non-segments radios', () => {
    renderForm({ kind: 'public' })
    expect(screen.getByRole('button', { name: /save changes/i })).not.toBeDisabled()
    renderForm({ kind: 'team' })
    expect(screen.getAllByRole('button', { name: /save changes/i })[0]).not.toBeDisabled()
  })

  it('disables Save while the mutation is pending, regardless of radio', () => {
    useUpdateBoardAccessSpy.mockReturnValue({
      mutate,
      isPending: true,
      isError: false,
      error: null,
    })
    renderForm({ kind: 'public' })
    const save = screen.getByRole('button', { name: /saving/i })
    expect(save).toBeDisabled()
  })
})

// ---------------------------------------------------------------------------
// Switching radio preserves segmentIds across cycles
// ---------------------------------------------------------------------------

describe('<BoardAccessForm> radio switching', () => {
  it('hides the multi-select when leaving segments but keeps the selection in form state', () => {
    renderForm({ kind: 'segments', segmentIds: ['seg_1', 'seg_2'] })
    expect((screen.getAllByRole('checkbox')[0] as HTMLInputElement).checked).toBe(true)
    // Switch to Public — multi-select hidden from the DOM
    fireEvent.click(screen.getAllByRole('radio')[0])
    expect(screen.queryByRole('list', { name: /allowlist|allowed segments/i })).toBeNull()
  })

  it('PRESERVES the original ticks when switching segments → other → segments', () => {
    // Admin accidentally toggles to a different kind, realizes they
    // meant to keep segments, switches back. The original selection
    // must come with them — losing it would silently undo their work.
    renderForm({ kind: 'segments', segmentIds: ['seg_1', 'seg_2'] })
    fireEvent.click(screen.getAllByRole('radio')[0]) // public
    fireEvent.click(screen.getAllByRole('radio')[3]) // back to segments
    const boxesAfter = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxesAfter[0].checked).toBe(true) // seg_1 still ticked
    expect(boxesAfter[1].checked).toBe(true) // seg_2 still ticked
  })

  it('submits the preserved selection after a switch cycle without further edits', async () => {
    renderForm({ kind: 'segments', segmentIds: ['seg_1'] })
    fireEvent.click(screen.getAllByRole('radio')[0]) // public
    fireEvent.click(screen.getAllByRole('radio')[3]) // back to segments
    // Save remains enabled because the original selection survived
    expect(screen.getByRole('button', { name: /save changes/i })).not.toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() => {
      expect(mutate).toHaveBeenCalledWith({
        boardId: BOARD_ID,
        audience: { kind: 'segments', segmentIds: ['seg_1'] },
      })
    })
  })
})

// ---------------------------------------------------------------------------
// Submit payloads
// ---------------------------------------------------------------------------

describe('<BoardAccessForm> submit payloads', () => {
  // react-hook-form's handleSubmit runs validation in a microtask before
  // calling onSubmit; assertions on `mutate` need waitFor to flush it.

  it('submits { kind: "public" } when Public is selected', async () => {
    renderForm({ kind: 'authenticated' })
    fireEvent.click(screen.getAllByRole('radio')[0]) // public
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith({
        boardId: BOARD_ID,
        audience: { kind: 'public' },
      })
    )
  })

  it('submits { kind: "authenticated" } when Authenticated is selected', async () => {
    renderForm({ kind: 'public' })
    fireEvent.click(screen.getAllByRole('radio')[1]) // authenticated
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith({
        boardId: BOARD_ID,
        audience: { kind: 'authenticated' },
      })
    )
  })

  it('submits { kind: "team" } when Team only is selected', async () => {
    renderForm({ kind: 'public' })
    fireEvent.click(screen.getAllByRole('radio')[2]) // team
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith({
        boardId: BOARD_ID,
        audience: { kind: 'team' },
      })
    )
  })

  it('submits { kind: "segments", segmentIds } when Specific segments is selected', async () => {
    renderForm({ kind: 'public' })
    fireEvent.click(screen.getAllByRole('radio')[3]) // segments
    fireEvent.click(screen.getAllByRole('checkbox')[0]) // seg_1
    fireEvent.click(screen.getAllByRole('checkbox')[1]) // seg_2
    fireEvent.click(screen.getByRole('button', { name: /save changes/i }))
    await waitFor(() =>
      expect(mutate).toHaveBeenCalledWith({
        boardId: BOARD_ID,
        audience: { kind: 'segments', segmentIds: ['seg_1', 'seg_2'] },
      })
    )
  })
})

// ---------------------------------------------------------------------------
// "Manage segments →" link
// ---------------------------------------------------------------------------

describe('<BoardAccessForm> manage-segments link', () => {
  it('renders a "Manage segments" link pointing at /admin/settings/people when segments is selected', () => {
    renderForm({ kind: 'segments', segmentIds: ['seg_1'] })
    const link = screen.getByRole('link', { name: /manage segments/i })
    expect(link).toHaveAttribute('href', '/admin/settings/people')
  })

  it('does NOT render the manage-segments link for non-segments radios', () => {
    renderForm({ kind: 'public' })
    expect(screen.queryByRole('link', { name: /manage segments/i })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Empty / loading / error states for segments query
// ---------------------------------------------------------------------------

describe('<BoardAccessForm> segments query states', () => {
  it('shows a loading message while the segments query is in flight', () => {
    useSegmentsSpy.mockReturnValue({ data: undefined, isLoading: true, isError: false })
    renderForm({ kind: 'segments', segmentIds: [] })
    expect(screen.getByText(/loading segments/i)).toBeInTheDocument()
  })

  it('shows an error message when the segments query fails', () => {
    useSegmentsSpy.mockReturnValue({ data: undefined, isLoading: false, isError: true })
    renderForm({ kind: 'segments', segmentIds: [] })
    expect(screen.getByText(/could not load segments/i)).toBeInTheDocument()
  })

  it('shows the create-segments nudge when no segments are configured', () => {
    useSegmentsSpy.mockReturnValue({ data: [], isLoading: false, isError: false })
    renderForm({ kind: 'segments', segmentIds: [] })
    expect(screen.getByText(/no segments defined yet/i)).toBeInTheDocument()
    // The nudge contains an inline link to People too.
    const links = screen.getAllByRole('link', { name: /people/i })
    expect(links.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Error rendering
// ---------------------------------------------------------------------------

describe('<BoardAccessForm> read-only mode (canEdit=false)', () => {
  // Visibility is admin-only on the server (updateBoardAccessFn rejects
  // non-admin callers). Showing the interactive form to a member-role
  // viewer is dishonest — they can't actually save. In read-only mode
  // we render the current audience as plain text + an explanatory line,
  // and we don't render any radios, save buttons, or segment pickers.

  it('renders the current audience as text + admin-only note for a public board', () => {
    renderForm({ kind: 'public' }, false)
    expect(screen.getByText(/Public/)).toBeInTheDocument()
    expect(screen.getByText(/admin/i)).toBeInTheDocument()
    // No interactive controls
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
    expect(screen.queryByRole('button', { name: /save changes/i })).toBeNull()
  })

  it('renders the audience as text for an authenticated board', () => {
    renderForm({ kind: 'authenticated' }, false)
    expect(screen.getByText(/Authenticated/)).toBeInTheDocument()
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
  })

  it('renders the audience as text for a team board', () => {
    renderForm({ kind: 'team' }, false)
    expect(screen.getByText(/Team only/)).toBeInTheDocument()
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
  })

  it('renders the audience as text + lists the segment names for a segments board', () => {
    renderForm({ kind: 'segments', segmentIds: ['seg_1', 'seg_2'] }, false)
    expect(screen.getByText(/Specific segments/)).toBeInTheDocument()
    // Segment names should appear so the member knows WHICH segments
    expect(screen.getByText(/Active Users/)).toBeInTheDocument()
    expect(screen.getByText(/New Users/)).toBeInTheDocument()
    expect(screen.queryAllByRole('radio')).toHaveLength(0)
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
  })

  it('does NOT call useUpdateBoardAccess (no mutation needed in read-only mode)', () => {
    useUpdateBoardAccessSpy.mockClear()
    renderForm({ kind: 'public' }, false)
    // The mutation hook should not have been invoked at all
    expect(useUpdateBoardAccessSpy).not.toHaveBeenCalled()
  })
})

describe('<BoardAccessForm> belt-and-braces submit guard', () => {
  // The disabled Save button gates the happy path. But a `disabled`
  // attribute doesn't prevent every submit channel: Enter key on a
  // focused input fires the form's submit handler directly. The
  // onSubmit handler must re-check the same condition the disable
  // logic uses, so neither bypasses the other.

  it('does NOT call mutate when submit fires with segments selected + zero ticked (Enter-key bypass)', async () => {
    renderForm({ kind: 'segments', segmentIds: [] })
    // Fire the form's native submit directly — what an Enter keypress
    // on a focused field would trigger inside this form.
    const formEl = screen.getByRole('button', { name: /save changes/i }).closest('form')!
    fireEvent.submit(formEl)
    // Wait a tick for react-hook-form's async handleSubmit to flush.
    await new Promise((r) => setTimeout(r, 50))
    expect(mutate).not.toHaveBeenCalled()
  })
})

describe('<BoardAccessForm> resyncs when board.audience prop changes', () => {
  // The mutation hook does optimistic updates and rolls back on error.
  // If the rollback flips board.audience back to its old value, the
  // form's internal state (held by react-hook-form's defaultValues)
  // doesn't follow — the form stays "lying" to the admin about what
  // the server actually has. A useEffect on board.audience must
  // reset the form so the radios match the source of truth.

  it('updates the selected radio when board.audience changes externally', () => {
    const qc = new QueryClient()
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <BoardAccessForm board={{ id: BOARD_ID, audience: { kind: 'public' } }} />
      </QueryClientProvider>
    )
    // shadcn RadioGroupItem renders as <button role="radio"> with
    // aria-checked, not a native input — read state via that attr.
    const radios = () => screen.getAllByRole('radio')
    expect(radios()[0].getAttribute('aria-checked')).toBe('true')

    // Server returned a different audience (rolled back, or refreshed
    // from a stale-while-revalidate). Form should follow.
    rerender(
      <QueryClientProvider client={qc}>
        <BoardAccessForm board={{ id: BOARD_ID, audience: { kind: 'team' } }} />
      </QueryClientProvider>
    )
    expect(radios()[2].getAttribute('aria-checked')).toBe('true')
    expect(radios()[0].getAttribute('aria-checked')).toBe('false')
  })

  it('restores the segmentIds when an audience prop flips to a segments kind', () => {
    const qc = new QueryClient()
    const { rerender } = render(
      <QueryClientProvider client={qc}>
        <BoardAccessForm board={{ id: BOARD_ID, audience: { kind: 'team' } }} />
      </QueryClientProvider>
    )
    // No multi-select yet
    expect(screen.queryByRole('list', { name: /allowlist|allowed segments/i })).toBeNull()

    // Prop flips to segments — multi-select appears with the right ticks
    rerender(
      <QueryClientProvider client={qc}>
        <BoardAccessForm
          board={{ id: BOARD_ID, audience: { kind: 'segments', segmentIds: ['seg_2'] } }}
        />
      </QueryClientProvider>
    )
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes[0].checked).toBe(false) // seg_1
    expect(boxes[1].checked).toBe(true) // seg_2
  })
})

describe('<BoardAccessForm> mutation error', () => {
  it('renders the mutation error message when the save fails', () => {
    useUpdateBoardAccessSpy.mockReturnValue({
      mutate,
      isPending: false,
      isError: true,
      error: new Error('Server said no'),
    })
    renderForm({ kind: 'public' })
    expect(screen.getByText(/server said no/i)).toBeInTheDocument()
  })
})
