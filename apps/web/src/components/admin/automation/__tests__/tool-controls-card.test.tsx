// @vitest-environment happy-dom
/**
 * Smoke coverage for the tool controls card: renders a row per tool from
 * listAssistantToolsFn, seeded from the saved control (or the tool's default
 * when nothing is saved).
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import type { ReactElement } from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const FIXTURE_TOOLS = [
  {
    name: 'search_knowledge',
    label: 'Search knowledge',
    description: 'Search the published help center.',
    risk: 'read' as const,
    supportedModes: ['disabled', 'autonomous'] as const,
    defaultMode: 'autonomous' as const,
  },
  {
    name: 'end_conversation',
    label: 'End conversation',
    description: 'Close the conversation once resolved.',
    risk: 'write' as const,
    supportedModes: ['disabled', 'approval', 'autonomous'] as const,
    defaultMode: 'approval' as const,
  },
]

vi.mock('@/lib/server/functions/assistant-guidance', () => ({
  listAssistantToolsFn: vi.fn(async () => FIXTURE_TOOLS),
}))

vi.mock('@/lib/server/functions/assistant-settings', () => ({
  getAssistantSettingsFn: vi.fn(async () => ({
    toolControls: { end_conversation: 'autonomous' },
    surfaces: {},
  })),
  updateAssistantToolControlsFn: vi.fn(),
  updateAssistantSurfacesFn: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
}))

import { ToolControlsCard } from '../tool-controls-card'

// Radix Select relies on these pointer/layout APIs happy-dom does not implement.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
  Element.prototype.hasPointerCapture = vi.fn(() => false)
  Element.prototype.setPointerCapture = vi.fn()
  Element.prototype.releasePointerCapture = vi.fn()
})

afterEach(cleanup)

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('ToolControlsCard', () => {
  it('renders a row per tool from listAssistantToolsFn', async () => {
    renderWithClient(<ToolControlsCard />)
    expect(await screen.findByText('Search knowledge')).toBeInTheDocument()
    expect(await screen.findByText('End conversation')).toBeInTheDocument()
  })

  it('shows a risk badge per tool', async () => {
    renderWithClient(<ToolControlsCard />)
    await screen.findByText('Search knowledge')
    expect(screen.getByText('Read')).toBeInTheDocument()
    expect(screen.getByText('Write')).toBeInTheDocument()
  })

  it('seeds the mode select from the saved control, falling back to the tool default', async () => {
    renderWithClient(<ToolControlsCard />)
    // end_conversation has a saved override (autonomous, not its approval default).
    expect(await screen.findByLabelText('End conversation mode')).toHaveTextContent('Autonomous')
    // search_knowledge has no saved control, so it falls back to its own default.
    expect(screen.getByLabelText('Search knowledge mode')).toHaveTextContent('Autonomous')
  })
})
