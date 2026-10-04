// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => (
    <a href={to}>{children}</a>
  ),
}))

import {
  INSTALL_HELP_AFTER_MS,
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
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

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

it('wraps the snippet inside its box so no line runs off the sheet', async () => {
  renderSheet()
  const snippet = (await screen.findAllByText(/Quackback\("init"\)/))[0].closest('pre')!
  expect(snippet.className).toContain('whitespace-pre-wrap')
  expect(snippet.className).toContain('break-all')
  // Reachable by keyboard so a long snippet can scroll.
  expect(snippet.getAttribute('tabindex')).toBe('0')
})

it('copies the short snippet and keeps identify behind a disclosure that links to Install settings', async () => {
  fns.status.mockResolvedValue({ seenHost: null, seenAt: null, enabled: false })
  renderSheet()
  fireEvent.click(await screen.findByTestId('install-copy'))
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled())
  const copied = vi.mocked(navigator.clipboard.writeText).mock.calls[0][0]
  expect(copied).toContain('Quackback("init");')
  expect(copied).not.toContain('identify')
  expect(screen.getByText('Copying or sending also turns on Show on your website.')).toBeTruthy()

  expect(screen.queryByRole('link', { name: 'Install settings' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Recognise signed-in users (optional)' }))
  const link = await screen.findByRole('link', { name: 'Install settings' })
  expect(link.getAttribute('href')).toBe('/admin/settings/widget/install')
})

it('after two minutes with no sign of Messenger, offers help with the content security policy', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  fns.status.mockResolvedValue({ seenHost: null, seenAt: null, enabled: true })
  renderSheet()
  expect(await screen.findByText('Waiting for your site')).toBeTruthy()
  act(() => vi.advanceTimersByTime(INSTALL_HELP_AFTER_MS - 1000))
  expect(screen.queryByText('No sign of Messenger yet')).toBeNull()
  act(() => vi.advanceTimersByTime(1000))
  expect(await screen.findByText('No sign of Messenger yet')).toBeTruthy()
  expect(screen.getByTestId('install-status').textContent).toContain('acme.quackback.test')
  fireEvent.click(screen.getByRole('button', { name: 'Send instructions to a developer' }))
  expect(document.activeElement).toBe(screen.getByPlaceholderText('developer@company.com'))
})

it('says when Messenger was seen only on a test site', async () => {
  fns.status.mockResolvedValue({
    seenHost: 'localhost:3000',
    seenAt: new Date().toISOString(),
    enabled: true,
  })
  renderSheet()
  expect(
    await screen.findByText('localhost:3000 looks like a test site. Check your live site too.')
  ).toBeTruthy()
})

it('gives no test-site note for a live site', async () => {
  fns.status.mockResolvedValue({
    seenHost: 'www.acme.example',
    seenAt: new Date().toISOString(),
    enabled: true,
  })
  renderSheet()
  await screen.findByText('Seen on www.acme.example just now')
  expect(screen.queryByText(/looks like a test site/)).toBeNull()
})

it('shows a failed send beside the field, naming the hourly limit when hit', async () => {
  fns.status.mockResolvedValue({ seenHost: null, seenAt: null, enabled: false })
  fns.send.mockRejectedValueOnce(new Error('Too many instruction emails. Try again in an hour.'))
  renderSheet()
  fireEvent.change(await screen.findByPlaceholderText('developer@company.com'), {
    target: { value: 'dev@acme.example' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Send instructions' }))
  expect((await screen.findByRole('alert')).textContent).toBe(
    'You sent several already. Try again in an hour.'
  )
  fns.send.mockRejectedValueOnce(new Error('{"status":500}'))
  fireEvent.click(screen.getByRole('button', { name: 'Send instructions' }))
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toBe(
      "Couldn't send the instructions. Try again later."
    )
  )
  fns.send.mockResolvedValueOnce({ sent: true })
  fireEvent.click(screen.getByRole('button', { name: 'Send instructions' }))
  expect(await screen.findByText('Instructions sent to dev@acme.example')).toBeTruthy()
  expect(screen.queryByRole('alert')).toBeNull()
})
