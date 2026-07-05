// @vitest-environment happy-dom
/**
 * Smoke coverage for the Basics card: the tone + length selects seed from
 * getAssistantSettingsFn.basics, falling back to a neutral default display
 * when nothing is saved, and save through updateAssistantBasicsFn on change.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import type { ReactElement } from 'react'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mockUpdateAssistantBasicsFn = vi.fn(async (input: { data: unknown }) => input.data)

vi.mock('@/lib/server/functions/assistant-settings', () => ({
  getAssistantSettingsFn: vi.fn(async () => ({
    toolControls: {},
    surfaces: {},
    basics: { tone: 'friendly', length: 'concise' },
  })),
  updateAssistantToolControlsFn: vi.fn(),
  updateAssistantSurfacesFn: vi.fn(),
  updateAssistantBasicsFn: (input: { data: unknown }) => mockUpdateAssistantBasicsFn(input),
}))

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn() }),
}))

// Radix Select relies on pointer-capture/scrollIntoView APIs jsdom/happy-dom
// don't implement; swap in the shared native-select test double so tone and
// length can be asserted with a plain toHaveValue check.
vi.mock('@/components/ui/select', async () => import('@/test/radix-select'))

import { AssistantBasicsCard } from '../assistant-basics-card'

afterEach(cleanup)

function renderWithClient(ui: ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>)
}

describe('AssistantBasicsCard', () => {
  it('renders the card title', async () => {
    renderWithClient(<AssistantBasicsCard />)
    expect(await screen.findByText('Basics')).toBeInTheDocument()
  })

  it('seeds tone and length from the saved preset', async () => {
    renderWithClient(<AssistantBasicsCard />)
    await waitFor(() => expect(screen.getByLabelText('Tone')).toHaveValue('friendly'))
    expect(screen.getByLabelText('Answer length')).toHaveValue('concise')
  })
})

describe('AssistantBasicsCard with nothing saved', () => {
  it('falls back to a neutral display default without writing anything', async () => {
    const { getAssistantSettingsFn } = await import('@/lib/server/functions/assistant-settings')
    vi.mocked(getAssistantSettingsFn).mockResolvedValueOnce({
      toolControls: {},
      surfaces: {},
      basics: {},
    } as never)

    renderWithClient(<AssistantBasicsCard />)
    expect(await screen.findByLabelText('Tone')).toHaveValue('neutral')
    expect(screen.getByLabelText('Answer length')).toHaveValue('standard')
    expect(mockUpdateAssistantBasicsFn).not.toHaveBeenCalled()
  })
})
