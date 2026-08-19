// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { Board, PostTag } from '@/lib/shared/db-types'

const mockBackfill = vi.fn()
vi.mock('@/lib/server/functions/post-tags', () => ({
  backfillAiTagsFn: (...args: unknown[]) => mockBackfill(...args),
}))

const mockToast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }))
vi.mock('sonner', () => ({ toast: mockToast }))

import { AiBackfillCard } from '../ai-backfill-card'

const BOARDS = [
  { id: 'board_1', name: 'Feature Requests' },
  { id: 'board_2', name: 'Bug Reports' },
] as unknown as Board[]

const PROMPTED_TAG = {
  id: 'tag_1',
  name: 'Bug',
  color: '#ef4444',
  aiPrompt: 'Reports of broken behavior',
} as unknown as PostTag
const PLAIN_TAG = {
  id: 'tag_2',
  name: 'UX',
  color: '#3b82f6',
  aiPrompt: null,
} as unknown as PostTag

beforeEach(() => {
  Element.prototype.scrollIntoView ??= (() => {}) as never
  vi.clearAllMocks()
  mockBackfill.mockResolvedValue({ scanned: 3, tagged: 2, hasMore: false })
})

/* Radix Select in happy-dom: focus the trigger and open with ArrowDown (the
 *  create-ticket-dialog test idiom), then click the option. */
async function pickBoard(optionText: string) {
  const trigger = screen.getByRole('combobox')
  trigger.focus()
  fireEvent.keyDown(trigger, { key: 'ArrowDown' })
  fireEvent.click(await screen.findByRole('option', { name: optionText }))
}

describe('<AiBackfillCard>', () => {
  it('renders nothing when no tag carries an AI prompt', () => {
    const { container } = render(<AiBackfillCard tags={[PLAIN_TAG]} boards={BOARDS} />)
    expect(container.firstChild).toBeNull()
  })

  it('applies AI tags to the chosen board in one action', async () => {
    render(<AiBackfillCard tags={[PROMPTED_TAG, PLAIN_TAG]} boards={BOARDS} />)

    await pickBoard('Bug Reports')
    fireEvent.click(screen.getByRole('button', { name: /apply to untagged posts/i }))

    await waitFor(() => expect(mockBackfill).toHaveBeenCalledWith({ data: { boardId: 'board_2' } }))
    await waitFor(() =>
      expect(mockToast.success).toHaveBeenCalledWith(expect.stringContaining('2 of 3'))
    )
  })

  it('tells the admin when untagged posts remain after the batch', async () => {
    mockBackfill.mockResolvedValue({ scanned: 50, tagged: 12, hasMore: true })
    render(<AiBackfillCard tags={[PROMPTED_TAG]} boards={BOARDS} />)

    await pickBoard('Feature Requests')
    fireEvent.click(screen.getByRole('button', { name: /apply to untagged posts/i }))

    await waitFor(() =>
      expect(mockToast.success).toHaveBeenCalledWith(expect.stringContaining('more remain'))
    )
  })
})
