// @vitest-environment happy-dom
/**
 * The per-run drill-down sheet (support platform §4.6/§7 follow-up):
 * workflow_run_events had no UI before this — a failing workflow was
 * invisible beyond the manager list's aggregate 7d counts. Covers the runs
 * list (state + relative time + conversation link), the selected run's event
 * timeline (including a humanized action_failed:<type> kind), and the empty
 * state for a workflow with no runs.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import type { ReactElement } from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    to,
    search,
    children,
    ...rest
  }: {
    to: string
    search?: Record<string, unknown>
    children: React.ReactNode
    [key: string]: unknown
  }) => (
    <a
      href={`${to}?${new URLSearchParams(search as Record<string, string>).toString()}`}
      {...(rest as React.HTMLAttributes<HTMLAnchorElement>)}
    >
      {children}
    </a>
  ),
}))

const hoisted = vi.hoisted(() => ({
  workflowRunsFn: vi.fn(),
  workflowRunTimelineFn: vi.fn(),
}))

vi.mock('@/lib/server/functions/workflow-reporting', () => ({
  workflowRunsFn: hoisted.workflowRunsFn,
  workflowRunTimelineFn: hoisted.workflowRunTimelineFn,
}))

import { WorkflowRunsSheet, humanizeRunEventKind } from '../workflow-runs-sheet'

afterEach(cleanup)

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

const RUNS = [
  {
    id: 'workflow_run_2',
    state: 'waiting',
    startedAt: '2026-01-05T12:00:00.000Z',
    endedAt: null,
    conversationId: null,
  },
  {
    id: 'workflow_run_1',
    state: 'done',
    startedAt: '2026-01-05T10:00:00.000Z',
    endedAt: '2026-01-05T10:05:00.000Z',
    conversationId: 'conversation_1',
  },
]

const TIMELINE_1 = [
  { kind: 'started', at: '2026-01-05T10:00:00.000Z' },
  { kind: 'action_failed:add_note', at: '2026-01-05T10:00:05.000Z' },
  { kind: 'completed', at: '2026-01-05T10:00:10.000Z' },
]

describe('humanizeRunEventKind', () => {
  it('maps the static run-event kinds to display labels', () => {
    expect(humanizeRunEventKind('started')).toBe('Started')
    expect(humanizeRunEventKind('waiting')).toBe('Waiting')
    expect(humanizeRunEventKind('completed')).toBe('Completed')
    expect(humanizeRunEventKind('interrupted')).toBe('Interrupted')
    expect(humanizeRunEventKind('swept_stale')).toBe('Swept (stale)')
    expect(humanizeRunEventKind('swept_rescheduled')).toBe('Swept (rescheduled)')
    expect(humanizeRunEventKind('swept_expired')).toBe('Expired (customer never answered)')
    expect(humanizeRunEventKind('block_sent')).toBe('Block sent')
    expect(humanizeRunEventKind('block_engaged')).toBe('Customer engaged')
  })

  it("humanizes an action_failed:<type> kind using the action's display label", () => {
    expect(humanizeRunEventKind('action_failed:add_note')).toBe('Action failed: Add internal note')
    expect(humanizeRunEventKind('action_failed:close')).toBe('Action failed: Close conversation')
  })

  it('falls back to the raw type for an unknown action_failed:<type>', () => {
    expect(humanizeRunEventKind('action_failed:some_removed_action')).toBe(
      'Action failed: some_removed_action'
    )
  })

  it('round-trips an unrecognized kind verbatim rather than rendering blank', () => {
    expect(humanizeRunEventKind('some_future_kind')).toBe('some_future_kind')
  })

  it('humanizes the call_connector park-and-continue loop event kinds', () => {
    expect(humanizeRunEventKind('connector_result:success')).toBe('Connector call succeeded')
    expect(humanizeRunEventKind('connector_hop_limit')).toBe('Stopped (connector hop limit)')
  })

  it('humanizes connector_failed:<reason> using a human reason, falling back to the raw reason', () => {
    expect(humanizeRunEventKind('connector_failed:rate_limited')).toBe(
      'Connector call failed (rate limited)'
    )
    expect(humanizeRunEventKind('connector_failed:host_not_allowed')).toBe(
      'Connector call failed (blocked host)'
    )
    expect(humanizeRunEventKind('connector_failed:http_error')).toBe(
      'Connector call failed (HTTP error)'
    )
    expect(humanizeRunEventKind('connector_failed:network_error')).toBe(
      'Connector call failed (network error)'
    )
    expect(humanizeRunEventKind('connector_failed:unavailable')).toBe(
      'Connector call failed (connector unavailable)'
    )
    expect(humanizeRunEventKind('connector_failed:invalid_params')).toBe(
      'Connector call failed (invalid inputs)'
    )
    expect(humanizeRunEventKind('connector_failed:some_future_reason')).toBe(
      'Connector call failed (some_future_reason)'
    )
  })
})

describe('WorkflowRunsSheet', () => {
  it('does not fetch while closed', () => {
    renderWithClient(
      <WorkflowRunsSheet
        workflowId="workflow_1"
        workflowName="Route VIPs"
        open={false}
        onOpenChange={() => {}}
      />
    )
    expect(hoisted.workflowRunsFn).not.toHaveBeenCalled()
  })

  it('shows the empty state for a workflow with no runs', async () => {
    hoisted.workflowRunsFn.mockResolvedValue([])
    renderWithClient(
      <WorkflowRunsSheet
        workflowId="workflow_1"
        workflowName="Route VIPs"
        open
        onOpenChange={() => {}}
      />
    )
    expect(await screen.findByText('No runs yet')).toBeInTheDocument()
    expect(hoisted.workflowRunTimelineFn).not.toHaveBeenCalled()
  })

  it('lists runs newest-first with a state badge and a conversation link only when one exists', async () => {
    hoisted.workflowRunsFn.mockResolvedValue(RUNS)
    hoisted.workflowRunTimelineFn.mockResolvedValue(TIMELINE_1)
    renderWithClient(
      <WorkflowRunsSheet
        workflowId="workflow_1"
        workflowName="Route VIPs"
        open
        onOpenChange={() => {}}
      />
    )
    expect(await screen.findByText('Waiting')).toBeInTheDocument()
    expect(screen.getByText('Done')).toBeInTheDocument()
    // Only the run with a conversationId gets a conversation link.
    const links = screen.getAllByRole('link', { name: /Open conversation/ })
    expect(links).toHaveLength(1)
    expect(links[0]).toHaveAttribute('href', expect.stringContaining('i=conversation_1'))
  })

  it("defaults the timeline to the most recent run's events", async () => {
    hoisted.workflowRunsFn.mockResolvedValue(RUNS)
    hoisted.workflowRunTimelineFn.mockResolvedValue([])
    renderWithClient(
      <WorkflowRunsSheet
        workflowId="workflow_1"
        workflowName="Route VIPs"
        open
        onOpenChange={() => {}}
      />
    )
    await screen.findByText('Waiting')
    expect(hoisted.workflowRunTimelineFn).toHaveBeenCalledWith({
      data: { runId: 'workflow_run_2' },
    })
  })

  it("renders the selected run's timeline, humanizing an action_failed:<type> kind", async () => {
    hoisted.workflowRunsFn.mockResolvedValue(RUNS)
    hoisted.workflowRunTimelineFn.mockResolvedValue(TIMELINE_1)
    renderWithClient(
      <WorkflowRunsSheet
        workflowId="workflow_1"
        workflowName="Route VIPs"
        open
        onOpenChange={() => {}}
      />
    )
    expect(await screen.findByText('Started')).toBeInTheDocument()
    expect(screen.getByText('Action failed: Add internal note')).toBeInTheDocument()
    expect(screen.getByText('Completed')).toBeInTheDocument()
  })

  it('switches the timeline when a different run row is clicked', async () => {
    const user = userEvent.setup()
    hoisted.workflowRunsFn.mockResolvedValue(RUNS)
    hoisted.workflowRunTimelineFn.mockImplementation(
      async ({ data }: { data: { runId: string } }) =>
        data.runId === 'workflow_run_1'
          ? [{ kind: 'completed', at: '2026-01-05T10:00:10.000Z' }]
          : TIMELINE_1
    )
    renderWithClient(
      <WorkflowRunsSheet
        workflowId="workflow_1"
        workflowName="Route VIPs"
        open
        onOpenChange={() => {}}
      />
    )
    await screen.findByText('Started') // the default (most-recent) run's timeline

    const doneRow = screen.getByText('Done').closest('button')
    expect(doneRow).toBeTruthy()
    await user.click(doneRow!)

    expect(await screen.findByText('Completed')).toBeInTheDocument()
    expect(screen.queryByText('Started')).not.toBeInTheDocument()
  })

  it('scopes the runs query to the given workflowId', async () => {
    hoisted.workflowRunsFn.mockResolvedValue([])
    renderWithClient(
      <WorkflowRunsSheet
        workflowId="workflow_42"
        workflowName="Route VIPs"
        open
        onOpenChange={() => {}}
      />
    )
    await screen.findByText('No runs yet')
    expect(hoisted.workflowRunsFn).toHaveBeenCalledWith({ data: { workflowId: 'workflow_42' } })
  })
})
