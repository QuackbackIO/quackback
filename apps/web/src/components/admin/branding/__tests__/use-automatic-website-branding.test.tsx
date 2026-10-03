// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import { afterEach, expect, it, vi } from 'vitest'
import { useAutomaticWebsiteBranding } from '../use-automatic-website-branding'
import { AutomaticBrandingNotice } from '../automatic-branding-notice'
import type { AutomaticBrandingStatus } from '@/lib/shared/website-branding'

const server = vi.hoisted(() => ({
  get: vi.fn(),
  start: vi.fn(),
  undo: vi.fn(),
  invalidate: vi.fn(),
}))
vi.mock('@/lib/server/functions/website-branding', () => ({
  getAutomaticWebsiteBrandingStatusFn: server.get,
  startAutomaticWebsiteBrandingFn: server.start,
  undoAutomaticWebsiteBrandingFn: server.undo,
}))
vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useSessionContext: () => ({ user: { id: 'acme-admin' } }),
}))
vi.mock('@tanstack/react-router', () => ({ useRouter: () => ({ invalidate: server.invalidate }) }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const applied: AutomaticBrandingStatus = {
  domain: 'example.com',
  pendingActionId: 'automatic-logo',
  status: 'applied',
  canUndo: true,
}
function Probe({ enabled = true }: { enabled?: boolean }) {
  const branding = useAutomaticWebsiteBranding({ enabled })
  return (
    <AutomaticBrandingNotice
      status={branding.status}
      pending={branding.pending}
      error={branding.error}
      onUndo={branding.undo}
    />
  )
}

async function mount(enabled = true) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  })
  let version = 'original'
  const key = ['settings', 'branding']
  await client.fetchQuery({
    queryKey: key,
    queryFn: async ({ queryKey }) => {
      expect(queryKey).toEqual(key)
      return version
    },
  })
  const snapshots: unknown[] = []
  server.invalidate.mockImplementation(async (...args: unknown[]) => {
    expect(args).toHaveLength(0)
    snapshots.push(client.getQueryData(key))
  })
  const view = render(
    <QueryClientProvider client={client}>
      <IntlProvider locale="en">
        <Probe enabled={enabled} />
      </IntlProvider>
    </QueryClientProvider>
  )
  return {
    client,
    snapshots,
    setVersion: (value: string) => {
      version = value
    },
    view,
  }
}

it('starts asynchronously with no client identity and refreshes a warm form before route context after Apply and Undo', async () => {
  let finish!: (status: AutomaticBrandingStatus) => void
  server.get.mockImplementation(async (...args: unknown[]) => {
    expect(args).toHaveLength(0)
    return null
  })
  server.start.mockImplementation((...args: unknown[]) => {
    expect(args).toHaveLength(0)
    return new Promise<AutomaticBrandingStatus>((resolve) => {
      finish = resolve
    })
  })
  const { client, snapshots, setVersion } = await mount()
  await waitFor(() => expect(server.start).toHaveBeenCalledTimes(1))
  expect(screen.queryByText('Logo from example.com')).toBeNull()
  setVersion('website')
  finish(applied)
  await screen.findByText('Logo from example.com')
  await waitFor(() => expect(snapshots).toEqual(['website']))
  server.undo.mockImplementation(async (...args: unknown[]) => {
    expect(args).toHaveLength(0)
    setVersion('original')
    return { ...applied, status: 'undone', canUndo: false }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
  await waitFor(() => expect(snapshots).toEqual(['website', 'original']))
  expect(screen.queryByText('Logo from example.com')).toBeNull()
  expect(server.start).toHaveBeenCalledTimes(1)
  client.clear()
})

it('reads an existing receipt without rerunning the lookup and keeps a stale Undo refusal visible', async () => {
  server.get.mockImplementation(async (...args: unknown[]) => {
    expect(args).toHaveLength(0)
    return applied
  })
  server.start.mockImplementation(() => {
    throw new Error('An existing receipt cannot start another lookup')
  })
  server.undo.mockImplementation(async (...args: unknown[]) => {
    expect(args).toHaveLength(0)
    throw { code: 'WEBSITE_BRANDING_UNDO_CONFLICT' }
  })
  const { client } = await mount()
  fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'These settings changed since Apply. Undo is unavailable.'
  )
  expect(screen.getByText('Logo from example.com')).toBeVisible()
  expect(server.start).not.toHaveBeenCalled()
  client.clear()
})

it('does not start automatic branding from the full checklist page', async () => {
  const { client } = await mount(false)
  expect(server.get).not.toHaveBeenCalled()
  expect(server.start).not.toHaveBeenCalled()
  expect(server.undo).not.toHaveBeenCalled()
  client.clear()
})

it('observes a lookup claimed on another device without starting a second lookup', async () => {
  let reads = 0
  server.get.mockImplementation(async (...args: unknown[]) => {
    expect(args).toHaveLength(0)
    return ++reads === 1 ? { ...applied, status: 'pending', canUndo: false } : applied
  })
  server.start.mockImplementation((...args: unknown[]) => {
    expect(args).toHaveLength(0)
    throw new Error('Another device owns the lookup claim')
  })
  const { client } = await mount()
  await screen.findByText('Logo from example.com', {}, { timeout: 2500 })
  expect(server.get).toHaveBeenCalledTimes(2)
  expect(server.start).not.toHaveBeenCalled()
  client.clear()
})
