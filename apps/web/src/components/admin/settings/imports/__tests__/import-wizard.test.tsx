// @vitest-environment happy-dom
/**
 * <ImportWizard> — the mapping + dry-run wizard (§I2), happy path.
 *
 * Covers the state-machine wiring between the already-unit-tested pure CSV
 * helpers and the server contract: upload a simple CSV with no status/board
 * columns (skips straight past value-mapping), dry-run, then commit and
 * poll to completion.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ImportWizard } from '../import-wizard'

vi.mock('@/lib/client/queries/admin', () => ({
  adminQueries: {
    boardsForSettings: () => ({
      queryKey: ['admin', 'settings', 'boards'],
      queryFn: async () => [{ id: 'board_1', slug: 'feedback', name: 'Feedback' }],
    }),
    statuses: () => ({
      queryKey: ['admin', 'statuses'],
      queryFn: async () => [],
    }),
  },
}))

const createBoardFn = vi.fn()
vi.mock('@/lib/server/functions/boards', () => ({
  createBoardFn: (...args: unknown[]) => createBoardFn(...args),
}))

const createStatusFn = vi.fn()
vi.mock('@/lib/server/functions/statuses', () => ({
  createStatusFn: (...args: unknown[]) => createStatusFn(...args),
}))

// Radix Select relies on pointer-capture/scrollIntoView APIs jsdom/happy-dom
// don't implement; swap in a native <select> so source/value-mapping choices
// are just fireEvent.change, matching the pattern in monday-config.test.tsx.
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

function renderWizard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <ImportWizard />
    </QueryClientProvider>
  )
}

function makeCsvFile(csv: string): File {
  return new File([csv], 'posts.csv', { type: 'text/csv' })
}

const fetchMock = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockReset()
  createBoardFn.mockReset()
  createStatusFn.mockReset()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('<ImportWizard> happy path', () => {
  it('uploads, auto-maps fields, dry-runs, commits, and polls to completion', async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/import' && init) {
        const body = init.body as FormData
        const mode = body.get('mode')
        if (mode === 'dry_run') {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                totalRows: 1,
                counts: { byBoard: {}, byStatus: {}, byAuthor: {} },
                sample: [
                  {
                    row: 1,
                    title: 'Dark mode',
                    board: null,
                    status: null,
                    author: 'Imported user',
                    isNewAuthor: false,
                    voteCount: 0,
                    action: 'create',
                  },
                ],
                errors: [],
                updatedCount: 0,
              }),
              { status: 200 }
            )
          )
        }
        if (mode === 'commit') {
          return Promise.resolve(
            new Response(JSON.stringify({ runId: 'import_run_1', status: 'pending' }), {
              status: 202,
            })
          )
        }
      }
      if (url === '/api/import/runs/import_run_1') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              run: {
                id: 'import_run_1',
                status: 'completed',
                totals: { rows: 1, created: 1, updated: 0, skipped: 0, errors: 0 },
              },
            }),
            { status: 200 }
          )
        )
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    })

    renderWizard()

    // Wait for the boards query to settle so the default-board select renders.
    await screen.findByText('Drop a CSV file here or click to browse')

    const file = makeCsvFile('title,content\nDark mode,Please add it\n')
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    // Field mapping step: title/content auto-mapped; no status/board columns
    // present, so Continue skips value-mapping and runs the dry run directly.
    await screen.findByText(/matched known columns automatically/)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    // Dry-run step
    await screen.findByText('Dark mode')
    expect(screen.getByText('Commit import')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Commit import' }))

    await waitFor(() => expect(screen.getByText('Import complete')).toBeInTheDocument())
    expect(screen.getByText('1')).toBeInTheDocument() // posts created count
  })

  it('routes through value-mapping and creates a new status inline before the dry run', async () => {
    createStatusFn.mockResolvedValue({ id: 'status_1', slug: 'planned', name: 'Planned' })
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/import' && init) {
        const body = init.body as FormData
        if (body.get('mode') === 'dry_run') {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                totalRows: 1,
                counts: { byBoard: {}, byStatus: { Planned: 1 }, byAuthor: {} },
                sample: [
                  {
                    row: 1,
                    title: 'Dark mode',
                    board: null,
                    status: 'planned',
                    author: 'Imported user',
                    isNewAuthor: false,
                    voteCount: 0,
                    action: 'create',
                  },
                ],
                errors: [],
                updatedCount: 0,
              }),
              { status: 200 }
            )
          )
        }
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    })

    renderWizard()

    await screen.findByText('Drop a CSV file here or click to browse')

    const file = makeCsvFile('title,content,status\nDark mode,Please add it,Planned\n')
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    await screen.findByText(/matched known columns automatically/)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    // Value-mapping step: the distinct "Planned" status value defaults to
    // "Create" since no existing status matches it.
    await screen.findByText('Map statuses')
    expect(screen.getByText('Planned')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Continue to dry run' }))

    await waitFor(() => expect(createStatusFn).toHaveBeenCalledTimes(1))
    const [call] = createStatusFn.mock.calls[0] as [{ data: { name: string } }]
    expect(call.data.name).toBe('Planned')

    await screen.findByText('Dark mode')
  })
})

describe('<ImportWizard> UserVoice source (§I3)', () => {
  it('detects the export, surfaces the caveat, and threads real voters through to commit', async () => {
    const voters = { '1': [{ email: 'alice@example.com' }] }
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (url === '/api/import/detect') {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              csv: 'title,content\nDark mode,Please add it\n',
              voters,
              caveats: ['This export only includes ideas that received at least one vote.'],
            }),
            { status: 200 }
          )
        )
      }
      if (url === '/api/import' && init) {
        const body = init.body as FormData
        if (body.get('mode') === 'dry_run') {
          expect(body.get('source')).toBe('uservoice')
          expect(JSON.parse(body.get('votersJson') as string)).toEqual(voters)
          return Promise.resolve(
            new Response(
              JSON.stringify({
                totalRows: 1,
                counts: { byBoard: {}, byStatus: {}, byAuthor: {} },
                sample: [
                  {
                    row: 1,
                    title: 'Dark mode',
                    board: null,
                    status: null,
                    author: 'Imported user',
                    isNewAuthor: false,
                    voteCount: 0,
                    action: 'create',
                  },
                ],
                errors: [],
                updatedCount: 0,
              }),
              { status: 200 }
            )
          )
        }
      }
      return Promise.reject(new Error(`Unexpected fetch: ${url}`))
    })

    renderWizard()

    await screen.findByText('Drop a CSV file here or click to browse')

    const sourceSelect = screen.getByDisplayValue('CSV file')
    fireEvent.change(sourceSelect, { target: { value: 'uservoice' } })

    await screen.findByText(/UserVoice full suggestions export/)

    const file = makeCsvFile('ideaId,ideaTitle,userEmailAddress\n1,Dark mode,alice@example.com\n')
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    fireEvent.change(input, { target: { files: [file] } })

    // Mapping step renders the canonical (already-normalized) fields and the caveat.
    await screen.findByText(/matched known columns automatically/)
    expect(screen.getByText(/at least one vote/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))

    // Dry run confirms the request carried source=uservoice + votersJson (asserted above).
    await screen.findByText('Dark mode')
  })
})
