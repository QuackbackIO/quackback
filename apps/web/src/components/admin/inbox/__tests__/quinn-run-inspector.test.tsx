// @vitest-environment happy-dom
/**
 * The inspector reads a run back honestly (QUINN-PRODUCT Step 11, P8).
 *
 * Two contracts are asserted here and both are ones a friendlier rendering
 * would break. An approved action that has been queued is drawn as approved and
 * queued, never as done, because that claim is the whole reason the two
 * readings are stored apart. And a control is offered only where the record
 * says it applies: no Stop on a finished run, no Run again on one that
 * succeeded.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import type { ReactElement } from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const listAssistantRunsFn = vi.fn()
const getAssistantRunFn = vi.fn()
vi.mock('@/lib/server/functions/assistant-runs', () => ({
  listAssistantRunsFn: (...args: unknown[]) => listAssistantRunsFn(...args),
  getAssistantRunFn: (...args: unknown[]) => getAssistantRunFn(...args),
  cancelAssistantRunFn: vi.fn(),
  retryAssistantRunFn: vi.fn(),
}))

import { QuinnRunInspector, dispositionNote } from '../quinn-run-inspector'

afterEach(cleanup)

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

const SUMMARY = {
  id: 'assistant_run_1',
  conversationId: 'conversation_1',
  ticketId: null,
  status: 'failed',
  phase: 'generation',
  outcome: null,
  disposition: 'stranded:no_worker',
  errorReason: 'the worker running this turn stopped before it finished',
  triggerKind: 'customer_message',
  surface: 'widget',
  attemptCount: 1,
  createdAt: '2026-03-01T00:00:00.000Z',
  startedAt: '2026-03-01T00:00:01.000Z',
  finishedAt: '2026-03-01T00:00:09.000Z',
  queuedMs: 1_000,
  totalMs: 9_000,
  delegation: null,
}

const DETAIL = {
  ...SUMMARY,
  steps: [],
  evidence: [],
  receipts: [],
  approvals: [
    {
      id: 'assistant_action_1',
      toolName: 'create_ticket',
      summary: 'Create a ticket for the refund',
      status: 'approved',
      executionState: 'queued',
      executionError: null,
      disposition: null,
      proposedAt: '2026-03-01T00:00:02.000Z',
      decidedAt: '2026-03-01T00:00:03.000Z',
      executedAt: null,
    },
  ],
  guidanceAppliedIds: ['guidance_entry_1'],
  guidanceOmittedIds: ['guidance_entry_2'],
  validation: [{ step: 'publication_validation', status: 'failed', verdict: null }],
  behaviour: {
    contentHash: 'abcdef0123456789',
    promptVersion: 'v7',
    configRevision: 4,
    validatorMode: 'shadow',
    retrievalSourceTypes: ['article'],
    embeddingModel: null,
    guidanceCount: 3,
    releaseNumber: 2,
    releaseStatus: 'published',
  },
  cancellable: false,
  retryable: true,
}

describe('dispositionNote', () => {
  it('names the states a person can act on and shows the rest verbatim', () => {
    expect(dispositionNote('stranded:no_worker')).toBe('The worker stopped before it finished')
    expect(dispositionNote('validation:unsupported')).toContain('Refused by validation')
    expect(dispositionNote('fence:newer_input')).toContain('Superseded')
    // An unrecognised disposition is information, not something to hide.
    expect(dispositionNote('something_new')).toBe('something_new')
    expect(dispositionNote(null)).toBeNull()
  })
})

describe('QuinnRunInspector', () => {
  it('renders nothing at all when the conversation has no runs', async () => {
    listAssistantRunsFn.mockResolvedValue([])
    const { container } = renderWithClient(<QuinnRunInspector conversationId="conversation_1" />)
    await Promise.resolve()
    expect(container.textContent).toBe('')
  })

  it('lists a run and opens its detail', async () => {
    listAssistantRunsFn.mockResolvedValue([SUMMARY])
    getAssistantRunFn.mockResolvedValue(DETAIL)
    renderWithClient(<QuinnRunInspector conversationId="conversation_1" />)
    const row = await screen.findByRole('button', { name: /Failed/ })
    row.click()
    expect(await screen.findByText('The worker stopped before it finished')).toBeInTheDocument()
    // The approval's two readings stay apart: approved AND queued, never done.
    expect(await screen.findByText(/Review: approved/)).toBeInTheDocument()
    expect(screen.getByText(/Execution: queued/)).toBeInTheDocument()
    expect(screen.queryByText(/completed/i)).not.toBeInTheDocument()
    // Guidance left out for room is said so, rather than counted as applied.
    expect(screen.getByText('1 applied, 1 left out for room')).toBeInTheDocument()
  })

  it('offers only the control the record says applies', async () => {
    listAssistantRunsFn.mockResolvedValue([SUMMARY])
    getAssistantRunFn.mockResolvedValue(DETAIL)
    renderWithClient(<QuinnRunInspector conversationId="conversation_1" />)
    ;(await screen.findByRole('button', { name: /Failed/ })).click()
    expect(await screen.findByRole('button', { name: 'Run again' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument()
  })

  it('offers Stop, and not Run again, while a run is still working', async () => {
    listAssistantRunsFn.mockResolvedValue([{ ...SUMMARY, status: 'running' }])
    getAssistantRunFn.mockResolvedValue({
      ...DETAIL,
      status: 'running',
      cancellable: true,
      retryable: false,
    })
    renderWithClient(<QuinnRunInspector conversationId="conversation_1" />)
    ;(await screen.findByRole('button', { name: /Working/ })).click()
    expect(await screen.findByRole('button', { name: 'Stop' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Run again' })).not.toBeInTheDocument()
  })
})
