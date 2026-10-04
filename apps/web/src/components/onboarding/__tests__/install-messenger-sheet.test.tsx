// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { IntlProvider } from 'react-intl'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const fns = vi.hoisted(() => ({
  status: vi.fn(),
  ready: vi.fn(async () => ({ ok: true })),
  send: vi.fn(async () => ({ sent: true })),
}))
vi.mock('@/lib/server/functions/going-live', () => ({
  getMessengerInstallStatusFn: fns.status,
  readyMessengerInstallFn: fns.ready,
  sendMessengerInstallInstructionsFn: fns.send,
}))
vi.mock('@/lib/client/hooks/use-root-context', () => ({
  useBaseUrl: () => 'https://acme.quackback.test',
}))
vi.mock('@/lib/client/queries/admin', () => ({
  adminQueries: { onboardingStatus: () => ({ queryKey: ['admin', 'onboarding'] }) },
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

import {
  INSTALL_POLL_MS,
  InstallMessengerSheet,
  installPollInterval,
  isSeenJustNow,
} from '../install-messenger-sheet'

beforeEach(() => {
  fns.status.mockReset()
  fns.ready.mockClear()
  fns.send.mockClear()
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn(async () => {}) },
    configurable: true,
  })
})
afterEach(cleanup)

function renderSheet(client = new QueryClient()) {
  render(
    <QueryClientProvider client={client}>
      <IntlProvider locale="en">
        <InstallMessengerSheet open onOpenChange={() => {}} />
      </IntlProvider>
    </QueryClientProvider>
  )
  return client
}

it('polls while waiting and stops once the site is seen', () => {
  expect(installPollInterval(null)).toBe(INSTALL_POLL_MS)
  expect(installPollInterval('www.acme.example')).toBe(false)
  const now = Date.parse('2026-10-04T12:00:00Z')
  expect(isSeenJustNow('2026-10-04T11:59:00Z', now)).toBe(true)
  expect(isSeenJustNow('2026-10-04T11:50:00Z', now)).toBe(false)
  expect(isSeenJustNow(null, now)).toBe(false)
})

it('waits for the site, then says it was seen just now and refreshes the launch plan', async () => {
  fns.status.mockResolvedValueOnce({ seenHost: null, seenAt: null, enabled: true })
  const client = renderSheet()
  const invalidate = vi.spyOn(client, 'invalidateQueries')
  expect(await screen.findByText('Waiting for your site')).toBeTruthy()
  fns.status.mockResolvedValue({
    seenHost: 'www.acme.example',
    seenAt: new Date().toISOString(),
    enabled: true,
  })
  await client.refetchQueries({ queryKey: ['onboarding', 'messenger-install'] })
  await waitFor(() =>
    expect(screen.getByTestId('install-status').textContent).toBe(
      'Seen on www.acme.example just now'
    )
  )
  await waitFor(() =>
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['admin', 'onboarding'] })
  )
})

it('names a site seen before the sheet opened without "just now"', async () => {
  fns.status.mockResolvedValue({
    seenHost: 'www.acme.example',
    seenAt: '2026-10-01T00:00:00Z',
    enabled: true,
  })
  renderSheet()
  expect(await screen.findByText('Seen on www.acme.example')).toBeTruthy()
})

it('copies the real snippet and switches Messenger on', async () => {
  fns.status.mockResolvedValue({ seenHost: null, seenAt: null, enabled: false })
  renderSheet()
  fireEvent.click(await screen.findByTestId('install-copy'))
  await waitFor(() => expect(fns.ready).toHaveBeenCalledTimes(1))
  expect(vi.mocked(navigator.clipboard.writeText).mock.calls[0][0]).toContain(
    'https://acme.quackback.test/api/widget/sdk.js'
  )
})

it('sends instructions to the developer address', async () => {
  fns.status.mockResolvedValue({ seenHost: null, seenAt: null, enabled: false })
  renderSheet()
  fireEvent.change(await screen.findByPlaceholderText('developer@company.com'), {
    target: { value: 'dev@acme.example' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Send instructions' }))
  await waitFor(() =>
    expect(fns.send).toHaveBeenCalledWith({ data: { email: 'dev@acme.example' } })
  )
})
