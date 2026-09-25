// @vitest-environment happy-dom
/**
 * The export and import history are warmed by the loaders of the pages that
 * show them (General's export action; the Imports & exports hub), so the
 * server-rendered page carries them and the browser fetches nothing more for
 * them after hydration. The history components are mounted against the query
 * client the loader filled; a read the loader missed shows up as a fetch.
 *
 * The runs are read through the real server function handlers (called in
 * process, as a server-side caller would), behind a stand-in for the auth gate
 * that admits only the permission and role it is given.
 */
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PERMISSIONS } from '@/lib/shared/permissions'

const { caller, served } = vi.hoisted(() => ({
  caller: { permissions: [] as string[], role: 'admin' },
  served: [] as string[],
}))

vi.mock('@tanstack/react-start', async (importOriginal) => {
  const { withServerFnsInProcess } = await import('@/test/server-fns-in-process')
  return withServerFnsInProcess(await importOriginal<typeof import('@tanstack/react-start')>())
})

vi.mock('@/lib/server/functions/auth-helpers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/auth-helpers')>()),
  requireAuth: vi.fn(async (options?: { permission?: string }) => {
    if (options?.permission && !caller.permissions.includes(options.permission)) {
      throw new Error(`Access denied: Requires permission '${options.permission}'`)
    }
    return {
      principal: { id: 'principal_1', role: caller.role, type: 'user' },
      permissions: caller.permissions,
      scope: 'dashboard',
    }
  }),
}))

const day = 86_400_000
vi.mock('@/lib/server/domains/export/export-run.service', () => ({
  listExportRuns: vi.fn(async () => {
    served.push('export runs')
    return [
      {
        id: 'export_run_1',
        status: 'completed',
        fileName: 'quackback-export-acme.zip',
        s3Key: 'exports/export_run_1.zip',
        sizeBytes: 2048,
        entityCounts: { posts: 12 },
        error: null,
        initiatedByPrincipalId: 'principal_1',
        createdAt: new Date(Date.now() - day),
        finishedAt: new Date(Date.now() - day + 60_000),
        expiresAt: new Date(Date.now() + 6 * day),
      },
    ]
  }),
}))
vi.mock('@/lib/server/domains/import/import-run.service', () => ({
  listImportRuns: vi.fn(async () => {
    served.push('import runs')
    return [
      {
        id: 'import_run_1',
        source: 'csv',
        fileName: 'ideas.csv',
        initiatedByPrincipalId: 'principal_1',
        status: 'completed',
        totals: { rows: 3, created: 3, updated: 0, skipped: 0, errors: 0 },
        errorReport: null,
        batchTagId: null,
        createdAt: new Date(Date.now() - 2 * day),
        finishedAt: new Date(Date.now() - 2 * day + 1000),
      },
    ]
  }),
}))

// The pages' other reads, which this file is not about.
vi.mock('@/lib/server/functions/cloud-identity', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/cloud-identity')>()),
  getCloudIdentityFn: vi.fn(async () => null),
}))
vi.mock('@/lib/server/functions/settings-utils', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/settings-utils')>()),
  fetchSettingsLogoData: vi.fn(async () => null),
}))
vi.mock('@/lib/server/functions/boards', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/server/functions/boards')>()),
  fetchBoardsFn: vi.fn(async () => []),
}))

// The registry the batched reads run from pulls in every query module; paid
// here, at file load, rather than inside the first test's timed body.
await import('@/lib/server/settings-read-registry')
const { ExportHistoryList } =
  await import('@/components/admin/settings/imports/export-history-list')
const { ExportWorkspaceAction } =
  await import('@/components/admin/settings/imports/export-workspace-action')
const { ImportHistoryList } =
  await import('@/components/admin/settings/imports/import-history-list')

type Loader = (ctx: { context: Record<string, unknown> }) => Promise<unknown>
async function loaderOf(path: string): Promise<Loader> {
  const { Route } = await import(/* @vite-ignore */ path)
  return (Route as { options: { loader: Loader } }).options.loader
}

let client: QueryClient
const fetchSpy = vi.fn()
beforeEach(() => {
  served.length = 0
  caller.permissions = [PERMISSIONS.SETTINGS_MANAGE]
  caller.role = 'admin'
  client = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: false } } })
  fetchSpy.mockReset()
  fetchSpy.mockImplementation(async () => new Response(JSON.stringify({ runs: [] })))
  vi.stubGlobal('fetch', fetchSpy)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

async function load(path: string) {
  const loader = await loaderOf(path)
  await loader({
    context: {
      queryClient: client,
      permissions: caller.permissions,
      principal: { id: 'principal_1', role: caller.role, userId: 'user_1' },
    },
  })
}

function mount(ui: React.ReactElement) {
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

describe('data history warmed by the settings loaders', () => {
  it('the General page carries the export runs its export action reads', async () => {
    await load('@/routes/admin/settings.general')
    expect(served).toEqual(['export runs'])
    mount(<ExportWorkspaceAction />)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(served).toEqual(['export runs'])
  })

  it('the Imports & exports hub carries both histories, shown on first render', async () => {
    await load('@/routes/admin/settings.imports')
    expect(served.sort()).toEqual(['export runs', 'import runs'])
    mount(
      <>
        <ExportWorkspaceAction />
        <ExportHistoryList />
        <ImportHistoryList />
      </>
    )
    expect(screen.getByText('12 posts')).toBeInTheDocument()
    expect(screen.getByText('ideas.csv')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /ZIP/ })).toHaveAttribute(
      'href',
      '/api/export/runs/export_run_1/download'
    )
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(served.sort()).toEqual(['export runs', 'import runs'])
  })

  it('keeps the import history to admins, as its REST read did', async () => {
    caller.role = 'member'
    const { listImportRunsFn, listExportRunsFn } = await import('@/lib/server/functions/data-runs')
    await expect(listImportRunsFn()).rejects.toThrow('Only admins can view import history')
    await listExportRunsFn()
    expect(served).toEqual(['export runs'])

    served.length = 0
    await load('@/routes/admin/settings.imports')
    expect(served).toEqual(['export runs'])
  })

  it('keeps both histories to holders of settings.manage', async () => {
    caller.permissions = [PERMISSIONS.MEMBER_VIEW]
    const { listImportRunsFn, listExportRunsFn } = await import('@/lib/server/functions/data-runs')
    await expect(listExportRunsFn()).rejects.toThrow("'settings.manage'")
    await expect(listImportRunsFn()).rejects.toThrow("'settings.manage'")
    expect(served).toEqual([])
  })
})
