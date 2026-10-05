// @vitest-environment happy-dom
/**
 * The /unsubscribe page: opening the link (GET) only reads the token, because
 * mail scanners and link previews open every link in an email. The change
 * happens when the person presses the confirm button.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

const fns = vi.hoisted(() => ({
  peek: vi.fn(),
  process: vi.fn(),
  loaderData: null as unknown,
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute:
    () =>
    <T extends object>(options: T) => ({
      ...options,
      useLoaderData: () => fns.loaderData,
    }),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}))
vi.mock('@/lib/server/functions/subscriptions', () => ({
  peekUnsubscribeTokenFn: (...args: unknown[]) => fns.peek(...args),
  processUnsubscribeTokenFn: (...args: unknown[]) => fns.process(...args),
}))
vi.mock('@/lib/server/functions/locale', () => ({
  loadUnsubscribeIntl: async () => ({ locale: 'en', messages: {} }),
}))

import { Route } from '../unsubscribe'

type Loader = (args: { deps: { token?: string } }) => Promise<unknown>
const route = Route as unknown as { loader: Loader; component: () => React.ReactElement }
const TOKEN = '6f1c1c47-3c0e-4d55-9a43-0d2a4f1c9b10'

beforeEach(() => {
  fns.peek.mockReset()
  fns.process.mockReset()
})
afterEach(cleanup)

async function openPage(token: string | undefined) {
  fns.loaderData = await route.loader({ deps: { token } })
  const Component = route.component
  render(<Component />)
}

describe('/unsubscribe', () => {
  it('opening the link reads the token and changes nothing', async () => {
    fns.peek.mockResolvedValue({ valid: true, action: 'unsubscribe_onboarding' })

    await openPage(TOKEN)

    expect(fns.peek).toHaveBeenCalledWith({ data: { token: TOKEN } })
    expect(fns.process).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'Stop setup tips?' })).toBeTruthy()
  })

  it('performs the change only when the person confirms', async () => {
    fns.peek.mockResolvedValue({ valid: true, action: 'unsubscribe_onboarding' })
    fns.process.mockResolvedValue({ success: true, action: 'unsubscribe_onboarding' })

    await openPage(TOKEN)
    fireEvent.click(screen.getByRole('button', { name: 'Stop setup tips' }))

    expect(await screen.findByText(/Setup tips are off/)).toBeTruthy()
    expect(fns.process).toHaveBeenCalledWith({ data: { token: TOKEN } })
    // The way back: setup tips can be turned on again in preferences.
    expect(screen.getByRole('link', { name: /Turn them back on/ }).getAttribute('href')).toBe(
      '/settings/preferences'
    )
  })

  it('shows the expired state for a used or expired token without trying to spend it', async () => {
    fns.peek.mockResolvedValue({ valid: false, error: 'invalid' })

    await openPage(TOKEN)

    expect(screen.getByRole('heading', { name: 'This link has expired' })).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('never calls the server for a malformed token', async () => {
    await openPage('not-a-uuid')

    expect(fns.peek).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { name: 'This link is not valid' })).toBeTruthy()
  })
})
