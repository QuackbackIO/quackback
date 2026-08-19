// @vitest-environment happy-dom
/**
 * <ImportCsv> — the template-driven CSV import flow: upload -> dry-run review
 * -> commit -> poll to completion. No mapping steps; the server contract is
 * the template.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ImportCsv } from '../import-csv'

vi.mock('@/lib/client/queries/admin', () => ({
  adminQueries: {
    boardsForSettings: () => ({
      queryKey: ['admin', 'settings', 'boards'],
      queryFn: async () => [{ id: 'board_1', slug: 'feedback', name: 'Feedback' }],
    }),
  },
}))

// Radix Select relies on pointer-capture/scrollIntoView APIs happy-dom
// doesn't implement; swap in a native <select> (see monday-config.test.tsx).
vi.mock('@/components/ui/select', () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string
    onValueChange: (v: string) => void
    children: React.ReactNode
  }) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>
      {children}
    </select>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: () => null,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => (
    <option value={value}>{children}</option>
  ),
}))

vi.mock('sonner', () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}))

import { toast } from 'sonner'

const PREVIEW = {
  totalRows: 2,
  counts: { byBoard: { bugs: 2 }, byStatus: { Open: 2 }, byAuthor: { 'a@example.com': 2 } },
  creates: { boards: [], statuses: ['In Progress'], tags: ['ui'] },
  sample: [
    {
      row: 1,
      title: 'First post',
      board: 'bugs',
      status: 'In Progress',
      author: 'a@example.com',
      isNewAuthor: true,
      voteCount: 3,
      action: 'create',
    },
  ],
  errors: [],
  updatedCount: 0,
}

const COMPLETED_RUN = {
  id: 'import_run_1',
  source: 'csv',
  fileName: 'posts.csv',
  status: 'completed',
  totals: { rows: 2, created: 2, updated: 0, skipped: 0, errors: 0 },
  errorReport: null,
  createdAt: new Date().toISOString(),
  finishedAt: new Date().toISOString(),
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function renderCsv() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ImportCsv />
    </QueryClientProvider>
  )
}

function chooseCsvFile() {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  const file = new File(['title,content\nFirst post,Body\n'], 'posts.csv', { type: 'text/csv' })
  fireEvent.change(input, { target: { files: [file] } })
}

beforeEach(() => {
  vi.clearAllMocks()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('<ImportCsv>', () => {
  it('walks upload -> dry-run review -> commit -> done', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url === '/api/import' && init?.method === 'POST') {
        const mode = (init.body as FormData).get('mode')
        return Promise.resolve(
          mode === 'dry_run'
            ? jsonResponse(PREVIEW)
            : jsonResponse({ runId: 'import_run_1', status: 'pending' }, 202)
        )
      }
      if (url === '/api/import/runs/import_run_1') {
        return Promise.resolve(jsonResponse({ run: COMPLETED_RUN }))
      }
      return Promise.resolve(jsonResponse({}, 404))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderCsv()
    chooseCsvFile()

    // Dry-run review: counts, auto-creation note, sample row.
    expect(await screen.findByText(/2 rows: 2 new posts, 0 updates, 0 skipped/)).toBeTruthy()
    expect(screen.getByText(/Will create: In Progress \(status\), ui \(tag\)/)).toBeTruthy()
    expect(screen.getByText('First post')).toBeTruthy()

    // Commit.
    fireEvent.click(screen.getByRole('button', { name: /Import 2 posts/ }))
    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([, init]) => (init?.body as FormData)?.get?.('mode') === 'commit'
        )
      ).toBe(true)
    })

    // Polls the run and lands on the completion summary.
    expect(await screen.findByText('Import complete')).toBeTruthy()
    expect(screen.getByText(/2 created/)).toBeTruthy()
  })

  it('stays on the upload step and toasts when the dry run is rejected', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({ error: 'Missing required columns: title' }, 400)))
    )

    renderCsv()
    chooseCsvFile()

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith('Missing required columns: title')
    })
    expect(screen.queryByText(/new posts/)).toBeNull()
  })
})
