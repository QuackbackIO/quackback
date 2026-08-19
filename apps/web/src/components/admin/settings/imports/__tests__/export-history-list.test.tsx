// @vitest-environment happy-dom
/**
 * <ExportHistoryList> + <ExportWorkspaceAction> — the workspace export card:
 * history rendering (empty/completed/expired/failed) and the start button's
 * in-flight behavior.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ExportHistoryList, formatBytes, summarizeEntityCounts } from '../export-history-list'
import { ExportWorkspaceAction } from '../export-workspace-action'

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const completedRun = {
  id: 'export_run_1',
  status: 'completed',
  fileName: 'quackback-export-acme-2026-07-17.zip',
  sizeBytes: 4_200_000,
  entityCounts: { posts: 1204, post_votes: 5632, post_comments: 310, users: 86 },
  error: null,
  createdAt: new Date(Date.now() - 3600_000).toISOString(),
  finishedAt: new Date(Date.now() - 3500_000).toISOString(),
  expiresAt: new Date(Date.now() + 6 * 86400_000).toISOString(),
}

function urlOf(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
}

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      return Promise.resolve(handler(urlOf(input), init))
    })
  )
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn())
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('formatBytes', () => {
  it('formats bytes, KB, and MB', () => {
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(4_200_000)).toBe('4.0 MB')
  })
})

describe('summarizeEntityCounts', () => {
  it('shows the first three entities with a "+N more" tail', () => {
    expect(summarizeEntityCounts(completedRun.entityCounts)).toBe(
      '1,204 posts · 5,632 post votes · 310 post comments +1 more'
    )
  })

  it('renders an em dash for empty counts', () => {
    expect(summarizeEntityCounts({})).toBe('—')
  })
})

describe('<ExportHistoryList>', () => {
  it('shows the empty state when there are no runs', async () => {
    stubFetch(() => jsonResponse({ runs: [] }))
    renderWithClient(<ExportHistoryList />)
    expect(await screen.findByText('No exports yet')).toBeTruthy()
  })

  it('renders a completed run with size, contents, and a download link', async () => {
    stubFetch(() => jsonResponse({ runs: [completedRun] }))
    renderWithClient(<ExportHistoryList />)

    expect(await screen.findByText('4.0 MB')).toBeTruthy()
    expect(screen.getByText(/1,204 posts/)).toBeTruthy()
    expect(screen.getByText('Completed')).toBeTruthy()
    const link = screen.getByRole('link', { name: /ZIP/ })
    expect(link.getAttribute('href')).toBe('/api/export/runs/export_run_1/download')
  })

  it('shows Expired instead of a link past expires_at', async () => {
    stubFetch(() =>
      jsonResponse({
        runs: [{ ...completedRun, expiresAt: new Date(Date.now() - 1000).toISOString() }],
      })
    )
    renderWithClient(<ExportHistoryList />)
    expect(await screen.findByText('Expired')).toBeTruthy()
    expect(screen.queryByRole('link')).toBeNull()
  })

  it('shows the error message for a failed run', async () => {
    stubFetch(() =>
      jsonResponse({
        runs: [
          {
            ...completedRun,
            status: 'failed',
            error: 'S3 unreachable',
            entityCounts: null,
            sizeBytes: null,
          },
        ],
      })
    )
    renderWithClient(<ExportHistoryList />)
    expect(await screen.findByText('S3 unreachable')).toBeTruthy()
    expect(screen.getByText('Failed')).toBeTruthy()
  })
})

describe('<ExportWorkspaceAction>', () => {
  it('starts an export on click', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (urlOf(input) === '/api/export/workspace' && init?.method === 'POST') {
        return Promise.resolve(jsonResponse({ runId: 'export_run_new' }, 202))
      }
      return Promise.resolve(jsonResponse({ runs: [] }))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWithClient(<ExportWorkspaceAction />)
    const button = await screen.findByRole('button', { name: /Export workspace data/ })
    fireEvent.click(button)

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            urlOf(input) === '/api/export/workspace' && (init as RequestInit)?.method === 'POST'
        )
      ).toBe(true)
    })
  })

  it('is disabled and shows progress while a run is in flight', async () => {
    stubFetch(() =>
      jsonResponse({
        runs: [{ ...completedRun, status: 'running', entityCounts: null, sizeBytes: null }],
      })
    )
    renderWithClient(<ExportWorkspaceAction />)
    const button = await screen.findByRole('button', { name: /Exporting…/ })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByText(/started/)).toBeTruthy()
  })
})
