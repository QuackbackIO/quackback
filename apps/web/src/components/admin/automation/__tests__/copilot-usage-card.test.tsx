// @vitest-environment happy-dom
/**
 * Smoke coverage for the Copilot usage card: the MetricTile headline row,
 * the Outcomes section (insert rate, inserted breakdown, feedback split),
 * the per-teammate leaderboard, the per-kind transform breakdown, and the
 * actions funnel from getCopilotUsageMetricsFn (mocked) — funnel and
 * approval-rate tile shown only with showActionsFunnel — including the
 * zero-state before any data loads.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import type { ReactElement } from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const METRICS = {
  totalQuestions: 42,
  totalTransforms: 7,
  transformsByKind: [
    { transform: 'my_tone', count: 5 },
    { transform: 'more_friendly', count: 2 },
  ],
  totalSummaries: 3,
  actionsProposed: 4,
  actionsApproved: 2,
  actionsRejected: 1,
  actionsExpired: 1,
  approvalRate: 50,
  answersInserted: 21,
  transformsInserted: 2,
  summariesInserted: 1,
  insertedReplies: 16,
  insertedNotes: 8,
  insertRate: 50,
  feedbackUp: 9,
  feedbackDown: 6,
  feedbackDownWithReason: 5,
  perTeammate: [
    { principalId: 'principal_1', displayName: 'Alice', questions: 30 },
    { principalId: 'principal_2', displayName: null, questions: 12 },
  ],
}

const hoisted = vi.hoisted(() => ({
  getCopilotUsageMetricsFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/assistant-copilot-analytics', () => ({
  getCopilotUsageMetricsFn: hoisted.getCopilotUsageMetricsFn,
}))

import { CopilotUsageCard } from '../copilot-usage-card'

afterEach(cleanup)

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('CopilotUsageCard', () => {
  it('mounts', () => {
    hoisted.getCopilotUsageMetricsFn.mockResolvedValue(METRICS)
    expect(() => renderWithClient(<CopilotUsageCard showActionsFunnel />)).not.toThrow()
  })

  it('renders the headline metric tiles', async () => {
    hoisted.getCopilotUsageMetricsFn.mockResolvedValue(METRICS)
    renderWithClient(<CopilotUsageCard showActionsFunnel />)

    expect(await screen.findByText('42')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByText('3')).toBeInTheDocument()
    // Approval rate and insert rate are both 50% in the fixture.
    expect(screen.getAllByText('50%').length).toBe(2)
  })

  it('renders the Outcomes section: insert rate, inserted breakdown, feedback signal', async () => {
    hoisted.getCopilotUsageMetricsFn.mockResolvedValue(METRICS)
    renderWithClient(<CopilotUsageCard showActionsFunnel />)

    // The insert-rate sub-line sums every inserted kind (21 + 2 + 1),
    // mirroring insertRate's own numerator.
    expect(await screen.findByText('24 inserted from 42 questions')).toBeInTheDocument()
    expect(screen.getByText('Outcomes')).toBeInTheDocument()
    expect(screen.getByText('Insert rate')).toBeInTheDocument()
    // The gesture-kind split...
    expect(screen.getByText('Answers inserted')).toBeInTheDocument()
    expect(screen.getByText('21')).toBeInTheDocument()
    expect(screen.getByText('Transforms inserted')).toBeInTheDocument()
    expect(screen.getByText('Summaries inserted')).toBeInTheDocument()
    // ...and the destination split.
    expect(screen.getByText('Landed in a reply')).toBeInTheDocument()
    expect(screen.getByText('16')).toBeInTheDocument()
    expect(screen.getByText('Landed in a note')).toBeInTheDocument()
    expect(screen.getByText('8')).toBeInTheDocument()
    // The up/down split lives on the Helpful-votes tile...
    expect(screen.getByText('Helpful votes')).toBeInTheDocument()
    expect(screen.getByText('6 not helpful')).toBeInTheDocument()
    // ...so the list carries only the count the tile can't show, not
    // duplicate Thumbs up/Thumbs down rows.
    expect(screen.getByText('Thumbs down with a reason')).toBeInTheDocument()
    expect(screen.queryByText('Thumbs up')).not.toBeInTheDocument()
    expect(screen.queryByText('Thumbs down')).not.toBeInTheDocument()
  })

  it('hides the actions funnel and approval-rate tile without showActionsFunnel, keeping Outcomes', async () => {
    hoisted.getCopilotUsageMetricsFn.mockResolvedValue(METRICS)
    renderWithClient(<CopilotUsageCard showActionsFunnel={false} />)

    expect(await screen.findByText('Outcomes')).toBeInTheDocument()
    expect(screen.queryByText('Actions funnel')).not.toBeInTheDocument()
    expect(screen.queryByText('Approval rate')).not.toBeInTheDocument()
    expect(screen.getByText('Insert rate')).toBeInTheDocument()
  })

  it('renders the per-teammate leaderboard, falling back for a missing display name', async () => {
    hoisted.getCopilotUsageMetricsFn.mockResolvedValue(METRICS)
    renderWithClient(<CopilotUsageCard showActionsFunnel />)

    expect(await screen.findByText('Alice')).toBeInTheDocument()
    expect(screen.getByText('30')).toBeInTheDocument()
    expect(screen.getByText('Unknown teammate')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
  })

  it('renders the per-kind transform breakdown with a friendly label', async () => {
    hoisted.getCopilotUsageMetricsFn.mockResolvedValue(METRICS)
    renderWithClient(<CopilotUsageCard showActionsFunnel />)

    expect(await screen.findByText('My tone')).toBeInTheDocument()
    expect(screen.getByText('More friendly')).toBeInTheDocument()
  })

  it('renders the actions funnel', async () => {
    hoisted.getCopilotUsageMetricsFn.mockResolvedValue(METRICS)
    renderWithClient(<CopilotUsageCard showActionsFunnel />)

    expect(await screen.findByText('Proposed')).toBeInTheDocument()
    expect(screen.getByText('Approved')).toBeInTheDocument()
    expect(screen.getByText('Rejected')).toBeInTheDocument()
    expect(screen.getByText('Expired')).toBeInTheDocument()
  })

  it('shows a zero-state before data loads', () => {
    hoisted.getCopilotUsageMetricsFn.mockResolvedValue(METRICS)
    renderWithClient(<CopilotUsageCard showActionsFunnel />)

    // Headline tiles render the placeholder dash while the query is pending.
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
  })

  it('shows an empty state when there are no Copilot questions for the period', async () => {
    hoisted.getCopilotUsageMetricsFn.mockResolvedValue({
      ...METRICS,
      totalQuestions: 0,
      perTeammate: [],
      transformsByKind: [],
    })
    renderWithClient(<CopilotUsageCard showActionsFunnel />)

    expect(await screen.findByText(/no copilot questions/i)).toBeInTheDocument()
  })

  it('fetches the last-30-days range', async () => {
    hoisted.getCopilotUsageMetricsFn.mockResolvedValue(METRICS)
    renderWithClient(<CopilotUsageCard showActionsFunnel />)

    await screen.findByText('42')
    expect(hoisted.getCopilotUsageMetricsFn).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          from: expect.any(String),
          to: expect.any(String),
        }),
      })
    )
  })
})
