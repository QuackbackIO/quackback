// @vitest-environment happy-dom
/**
 * Smoke coverage for the surface instructions card: the widget textarea
 * loads its saved value from getAssistantSettingsFn.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import type { ReactElement } from 'react'
import { render, screen, cleanup } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

vi.mock('@/lib/server/functions/assistant-settings', () => ({
  getAssistantSettingsFn: vi.fn(async () => ({
    toolControls: {},
    surfaces: { widget: { instructions: 'Keep replies under three sentences.' } },
  })),
  updateAssistantToolControlsFn: vi.fn(),
  updateAssistantSurfacesFn: vi.fn(),
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
}))

import { SurfaceInstructionsCard } from '../surface-instructions-card'

afterEach(cleanup)

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('SurfaceInstructionsCard', () => {
  it('loads the widget surface instructions from getAssistantSettingsFn', async () => {
    renderWithClient(<SurfaceInstructionsCard />)
    expect(await screen.findByDisplayValue('Keep replies under three sentences.')).toBeInTheDocument()
  })
})
