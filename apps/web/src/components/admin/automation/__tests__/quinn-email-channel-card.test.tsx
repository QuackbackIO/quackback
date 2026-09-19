// @vitest-environment happy-dom
/**
 * The Deploy page's Email row reads real availability (QUINN-PRODUCT P9).
 *
 * The repository's own rule is that a control whose backend gate is not
 * implemented is not rendered, and not rendered disabled either. Autonomous
 * email needs an inbound route to arrive on and Quinn answering customers at
 * all, so the row names whichever is missing and offers the switch only when
 * neither is.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import type { ReactElement } from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const getAssistantEmailChannelFn = vi.fn()
const updateAssistantEmailChannelFn = vi.fn()
vi.mock('@/lib/server/functions/assistant-channels', () => ({
  getAssistantEmailChannelFn: (...args: unknown[]) => getAssistantEmailChannelFn(...args),
  updateAssistantEmailChannelFn: (...args: unknown[]) => updateAssistantEmailChannelFn(...args),
}))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, ...rest }: { children: React.ReactNode }) => <a {...rest}>{children}</a>,
}))

import { QuinnEmailChannelCard } from '../quinn-email-channel-card'

afterEach(cleanup)

function renderCard(): ReactElement {
  return <QuinnEmailChannelCard />
}

function withClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('the Deploy Email row', () => {
  it('names the missing inbound route and offers no switch', async () => {
    getAssistantEmailChannelFn.mockResolvedValue({
      inboundConfigured: false,
      enabled: false,
      respondsToCustomers: true,
    })
    withClient(renderCard())
    expect(await screen.findByText('Set up an inbound email address first.')).toBeTruthy()
    expect(screen.getByText('Setup required')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /turn on/i })).toBeNull()
  })

  it('names the missing customer switch and still offers no switch', async () => {
    getAssistantEmailChannelFn.mockResolvedValue({
      inboundConfigured: true,
      enabled: false,
      respondsToCustomers: false,
    })
    withClient(renderCard())
    expect(await screen.findByText('Turn on Quinn for customer conversations first.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /turn on/i })).toBeNull()
  })

  it('offers the switch once both are in place, and says it is off', async () => {
    getAssistantEmailChannelFn.mockResolvedValue({
      inboundConfigured: true,
      enabled: false,
      respondsToCustomers: true,
    })
    withClient(renderCard())
    expect(await screen.findByRole('button', { name: 'Turn on' })).toBeTruthy()
    expect(screen.getByText('Off')).toBeTruthy()
  })

  it('reads as on once the workspace enabled it', async () => {
    getAssistantEmailChannelFn.mockResolvedValue({
      inboundConfigured: true,
      enabled: true,
      respondsToCustomers: true,
    })
    withClient(renderCard())
    expect(await screen.findByRole('button', { name: 'Turn off' })).toBeTruthy()
    expect(screen.getByText('On')).toBeTruthy()
  })
})
