// @vitest-environment happy-dom
/**
 * Hover-card overlay drives the per-chip popover via event delegation.
 *
 * We assert two behaviours that matter at the integration boundary:
 *   1. Hovering a `.mention` chip triggers the principal-card fetch and the
 *      popover content renders with the resolved displayName.
 *   2. A 404 response (deleted principal) suppresses the popover so the
 *      chip stays as plain text.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import {
  MentionHoverCardOverlay,
  __resetMentionHoverCardCacheForTests,
} from '../mention-hover-card-overlay'

function renderWithChip(html: string) {
  return render(
    <MentionHoverCardOverlay>
      <div data-testid="content" dangerouslySetInnerHTML={{ __html: html }} />
    </MentionHoverCardOverlay>
  )
}

describe('<MentionHoverCardOverlay>', () => {
  beforeEach(() => {
    __resetMentionHoverCardCacheForTests()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('shows a popover with the principal displayName when a mention chip is hovered', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        principalId: 'principal_jane',
        displayName: 'Jane Doe',
        avatarUrl: null,
        role: 'admin',
        joinedAt: '2024-01-15T08:00:00.000Z',
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWithChip(
      '<p>Hello <span class="mention" data-principal-id="principal_jane" data-display-name="Jane Doe">@Jane Doe</span></p>'
    )

    const chip = document.querySelector('.mention') as HTMLElement
    expect(chip).toBeTruthy()

    fireEvent.mouseEnter(chip)
    // Advance past the 150ms open delay so setAnchor fires.
    vi.advanceTimersByTime(200)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/v1/users/principal_jane/card',
        expect.objectContaining({ credentials: 'include' })
      )
    })

    await waitFor(() => {
      // Popover renders inside a portal — query the whole document.
      expect(screen.getByText('Jane Doe')).toBeInTheDocument()
    })
  })

  it('suppresses the popover when the principal-card endpoint returns 404', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ error: 'Not Found' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWithChip(
      '<p>Ghost <span class="mention" data-principal-id="principal_deleted" data-display-name="Gone">@Gone</span></p>'
    )

    const chip = document.querySelector('.mention') as HTMLElement
    fireEvent.mouseEnter(chip)
    vi.advanceTimersByTime(200)

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    // Let the fetch promise settle and React flush the state updates.
    await Promise.resolve()
    await Promise.resolve()

    // No popover content rendered. Role labels only appear inside the card
    // body, so their absence confirms the popover stayed closed.
    expect(screen.queryByText(/admin/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/member/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/customer/i)).not.toBeInTheDocument()
  })
})
