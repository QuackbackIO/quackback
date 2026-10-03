// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import { afterEach, expect, it, vi } from 'vitest'
import {
  brandingPollInterval,
  useAutomaticWebsiteBranding,
} from '../use-automatic-website-branding'
import { AutomaticBrandingNotice } from '../automatic-branding-notice'
import type { AutomaticBrandingStatus } from '@/lib/shared/website-branding'

const server = vi.hoisted(() => ({
  get: vi.fn(),
  start: vi.fn(),
  accept: vi.fn(),
  decline: vi.fn(),
  undo: vi.fn(),
  invalidate: vi.fn(),
}))
vi.mock('@/lib/server/functions/website-branding', () => ({
  getAutomaticWebsiteBrandingStatusFn: server.get,
  startAutomaticWebsiteBrandingFn: server.start,
  acceptWebsiteBrandingOfferFn: server.accept,
  declineWebsiteBrandingOfferFn: server.decline,
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

const status = (
  value: AutomaticBrandingStatus['status'],
  extra: Partial<AutomaticBrandingStatus> = {}
): AutomaticBrandingStatus => ({
  domain: 'example.com',
  status: value,
  logoUrl: null,
  colorApplied: false,
  canUndo: false,
  canUse: false,
  ...extra,
})
const applied = status('applied', { logoUrl: '/api/storage/logos/acme.png', canUndo: true })
const offered = status('offered', { logoUrl: '/api/storage/logos/acme.ico', canUse: true })
/** Every server function here takes no input; a call with arguments is a contract break. */
const noArgs =
  <T,>(result: () => T) =>
  (...args: unknown[]) => {
    expect(args).toHaveLength(0)
    return result()
  }

function Probe({ enabled = true }: { enabled?: boolean }) {
  const branding = useAutomaticWebsiteBranding({ enabled })
  return (
    <AutomaticBrandingNotice
      status={branding.status}
      pending={branding.pending}
      error={branding.error}
      onUndo={branding.undo}
      onAccept={branding.accept}
      onDismiss={branding.dismiss}
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

it('starts an eligible lookup once and refreshes a warm form before route context after it applies and after Undo', async () => {
  let finish!: (value: AutomaticBrandingStatus) => void
  server.get.mockImplementation(noArgs(async () => status('eligible')))
  server.start.mockImplementation(
    noArgs(
      () =>
        new Promise<AutomaticBrandingStatus>((resolve) => {
          finish = resolve
        })
    )
  )
  const { client, snapshots, setVersion } = await mount()
  await waitFor(() => expect(server.start).toHaveBeenCalledTimes(1))
  expect(screen.queryByText('Logo from example.com')).toBeNull()
  setVersion('website')
  finish(applied)
  await screen.findByText('Logo from example.com')
  await waitFor(() => expect(snapshots).toEqual(['website']))
  server.undo.mockImplementation(
    noArgs(async () => {
      setVersion('original')
      return status('undone')
    })
  )
  fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
  await waitFor(() => expect(snapshots).toEqual(['website', 'original']))
  expect(screen.queryByText('Logo from example.com')).toBeNull()
  expect(server.start).toHaveBeenCalledTimes(1)
  client.clear()
})

it.each([
  ['no status at all', null],
  ['a declined offer', status('declined')],
  ['a skipped lookup', status('skipped')],
  ['a failed lookup', status('failed')],
])('never asks to start, or takes the row lock, for %s', async (_, current) => {
  server.get.mockImplementation(noArgs(async () => current))
  server.start.mockImplementation(() => {
    throw new Error('An ineligible teammate cannot start a lookup')
  })
  const { client } = await mount()
  await waitFor(() => expect(server.get).toHaveBeenCalledTimes(1))
  expect(server.start).not.toHaveBeenCalled()
  expect(server.invalidate).not.toHaveBeenCalled()
  client.clear()
})

it('reads an applied change without restarting or refreshing, and shows the automatic Undo refusal', async () => {
  server.get.mockImplementation(noArgs(async () => applied))
  server.start.mockImplementation(() => {
    throw new Error('An existing lookup cannot start another')
  })
  server.undo.mockImplementation(
    noArgs(async () => {
      throw { code: 'WEBSITE_BRANDING_UNDO_CONFLICT' }
    })
  )
  const { client } = await mount()
  fireEvent.click(await screen.findByRole('button', { name: 'Undo' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'The branding changed since then. Undo is unavailable.'
  )
  expect(screen.getByText('Logo from example.com')).toBeVisible()
  expect(server.start).not.toHaveBeenCalled()
  expect(server.invalidate).not.toHaveBeenCalled()
  client.clear()
})

it('applies an offered logo with Use it and then offers Undo', async () => {
  server.get.mockImplementation(noArgs(async () => offered))
  server.accept.mockImplementation(noArgs(async () => applied))
  const { client, snapshots } = await mount()
  fireEvent.click(await screen.findByRole('button', { name: 'Use it' }))
  await screen.findByText('Logo from example.com')
  expect(screen.getByRole('button', { name: 'Undo' })).toBeVisible()
  await waitFor(() => expect(snapshots).toHaveLength(1))
  expect(server.decline).not.toHaveBeenCalled()
  client.clear()
})

it('closes an offer with Not now without touching settings', async () => {
  server.get.mockImplementation(noArgs(async () => offered))
  server.decline.mockImplementation(noArgs(async () => status('declined')))
  const { client, view } = await mount()
  fireEvent.click(await screen.findByRole('button', { name: 'Not now' }))
  await waitFor(() => expect(view.container).toBeEmptyDOMElement())
  expect(server.accept).not.toHaveBeenCalled()
  expect(server.invalidate).not.toHaveBeenCalled()
  client.clear()
})

it('does not read or start anything while disabled', async () => {
  const { client } = await mount(false)
  expect(server.get).not.toHaveBeenCalled()
  expect(server.start).not.toHaveBeenCalled()
  client.clear()
})

it('observes a lookup claimed on another device without starting a second one', async () => {
  let reads = 0
  server.get.mockImplementation(noArgs(async () => (++reads === 1 ? status('pending') : applied)))
  server.start.mockImplementation(() => {
    throw new Error('Another device owns the lookup claim')
  })
  const { client } = await mount()
  await screen.findByText('Logo from example.com', {}, { timeout: 4500 })
  expect(server.get).toHaveBeenCalledTimes(2)
  expect(server.start).not.toHaveBeenCalled()
  client.clear()
})

it('polls only a pending lookup, and only a bounded number of times', () => {
  expect(brandingPollInterval(status('pending'), 0)).toBeGreaterThan(0)
  expect(brandingPollInterval(status('pending'), 29)).toBeGreaterThan(0)
  expect(brandingPollInterval(status('pending'), 30)).toBe(false)
  expect(brandingPollInterval(applied, 0)).toBe(false)
  expect(brandingPollInterval(null, 0)).toBe(false)
  expect(brandingPollInterval(undefined, 0)).toBe(false)
})
