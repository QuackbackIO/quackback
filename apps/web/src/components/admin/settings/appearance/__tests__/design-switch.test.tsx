// @vitest-environment happy-dom
/**
 * A portal with its own CSS is offered the switch on its old Settings › Portal
 * page: the CSS report, today's portal beside the switched one, and Switch,
 * held back while the CSS has refusals. Once switched, Versions offers the way
 * back.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const server = vi.hoisted(() => ({
  invalidations: 0,
  switches: 0,
  switchesBack: 0,
  outcome: { ok: true } as { ok: true } | { ok: false; code: string; message: string },
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({
    invalidate: async () => {
      server.invalidations++
    },
  }),
  ClientOnly: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
vi.mock('@/components/admin/settings/branding/portal-preview', () => ({
  PortalPreview: ({ switched }: { switched: boolean }) => (
    <div data-testid="frame" data-switched={String(switched)} />
  ),
}))
vi.mock('@/lib/server/functions/portal-design', () => ({
  getPortalDesignSwitchFn: async () => null,
  listPortalDesignVersionsFn: async () => [],
  switchPortalDesignFn: async () => {
    server.switches++
    return server.outcome
  },
  switchBackPortalDesignFn: async () => {
    server.switchesBack++
    return server.outcome
  },
}))

const { portalDesignQueries } = await import('@/lib/client/queries/portal-design')
const { DesignSwitchCard } = await import('../design-switch-card')
const { HistoryDialog } = await import('../history-dialog')

const REPORT = {
  errors: [] as Array<{ message: string; line?: number }>,
  warnings: [{ message: '.portal-nav__item is internal and may change.', line: 3 }],
  carried: [{ message: '--primary on :root becomes the accent.' }],
}

function withClient(ui: ReactNode, state: unknown) {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
  client.setQueryData(portalDesignQueries.switch().queryKey, state)
  client.setQueryData(portalDesignQueries.versions().queryKey, [])
  render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

const card = <DesignSwitchCard workspaceName="Acme" faviconUrl={null} />

afterEach(() => {
  cleanup()
  server.invalidations = 0
  server.switches = 0
  server.switchesBack = 0
  server.outcome = { ok: true }
})

describe('the switch card', () => {
  it('is absent when there is nothing to switch', () => {
    withClient(card, { available: false, canSwitchBack: true, report: REPORT })
    expect(screen.queryByRole('button', { name: 'Switch' })).toBeNull()
  })

  it('reports the CSS and compares today with the portal switched', () => {
    withClient(card, { available: true, canSwitchBack: false, report: REPORT })
    expect(screen.getByRole('list', { name: 'Moves into the design' }).textContent).toBe(
      '--primary on :root becomes the accent.'
    )
    expect(screen.getByRole('list', { name: 'Check after switching' }).textContent).toBe(
      'Line 3: .portal-nav__item is internal and may change.'
    )
    expect(screen.queryAllByTestId('frame')).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Compare' }))
    expect(screen.getAllByTestId('frame').map((frame) => frame.dataset.switched)).toEqual([
      'false',
      'true',
    ])
  })

  it('switches and reloads the page as Appearance', async () => {
    withClient(card, { available: true, canSwitchBack: false, report: REPORT })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Switch' })))
    expect(server.switches).toBe(1)
    expect(server.invalidations).toBe(1)
  })

  it('holds the switch while the CSS has refusals, and shows a refusal', async () => {
    withClient(card, {
      available: true,
      canSwitchBack: false,
      report: { ...REPORT, errors: [{ message: '@import is not allowed.', line: 1 }] },
    })
    expect(
      screen.getByRole('list', { name: 'Fix in Advanced CSS before switching' }).textContent
    ).toBe('Line 1: @import is not allowed.')
    expect(screen.getByRole('button', { name: 'Switch' }).hasAttribute('disabled')).toBe(true)

    cleanup()
    server.outcome = { ok: false, code: 'DESIGN_CHANGED', message: 'Already switched.' }
    withClient(card, { available: true, canSwitchBack: false, report: REPORT })
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Switch' })))
    expect(screen.getByRole('alert').textContent).toBe('Already switched.')
    expect(server.invalidations).toBe(0)
  })
})

describe('switching back', () => {
  const dialog = (
    <HistoryDialog
      open
      onOpenChange={() => {}}
      currentNumber={1}
      onRestore={async () => ({ ok: true })}
    />
  )

  it('is offered once the portal has switched, and asks first', async () => {
    withClient(dialog, { available: false, canSwitchBack: true, report: REPORT })
    fireEvent.click(await screen.findByRole('button', { name: 'Switch back' }))
    expect(server.switchesBack).toBe(0)
    const confirm = await screen.findByRole('alertdialog')
    await act(async () =>
      fireEvent.click(
        [...confirm.querySelectorAll('button')].find((b) => b.textContent === 'Switch back')!
      )
    )
    expect(server.switchesBack).toBe(1)
    await waitFor(() => expect(server.invalidations).toBe(1))
  })

  it('is not offered to a portal that never switched', async () => {
    withClient(dialog, { available: false, canSwitchBack: false, report: REPORT })
    await screen.findByRole('dialog')
    expect(screen.queryByRole('button', { name: 'Switch back' })).toBeNull()
  })
})
