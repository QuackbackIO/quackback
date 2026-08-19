// @vitest-environment happy-dom
/**
 * Coverage for the feedback inbox bulk-action bar: it surfaces while a
 * multi-selection is active and applies one status change to the whole target
 * set — picking a status reports the chosen status id to the caller (which fans
 * it out over the selection), and the clear control drops the selection.
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PostStatusEntity } from '@/lib/shared/db-types'

import { FeedbackBulkActionBar } from '../feedback-bulk-action-bar'

afterEach(cleanup)

const STATUSES = [
  { id: 'post_status_open', name: 'Open', slug: 'open', color: '#6b7280' },
  { id: 'post_status_planned', name: 'Planned', slug: 'planned', color: '#3b82f6' },
  { id: 'post_status_done', name: 'Done', slug: 'done', color: '#22c55e' },
] as unknown as PostStatusEntity[]

function renderBar(props: Partial<React.ComponentProps<typeof FeedbackBulkActionBar>> = {}) {
  return render(
    <FeedbackBulkActionBar
      count={3}
      statuses={STATUSES}
      pending={false}
      onClear={() => {}}
      onChangeStatus={() => {}}
      {...props}
    />
  )
}

describe('FeedbackBulkActionBar', () => {
  it('shows the selection count', () => {
    renderBar()
    expect(screen.getByText('3 selected')).toBeInTheDocument()
  })

  it('reports the picked status id for the whole selection', async () => {
    const onChangeStatus = vi.fn()
    renderBar({ onChangeStatus })

    await userEvent.click(screen.getByRole('button', { name: /status/i }))
    await userEvent.click(await screen.findByText('Planned'))
    expect(onChangeStatus).toHaveBeenCalledWith('post_status_planned')
  })

  it('clears the selection from the dismiss control', async () => {
    const onClear = vi.fn()
    renderBar({ onClear })
    await userEvent.click(screen.getByRole('button', { name: /clear selection/i }))
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it('disables the status trigger while a batch is in flight', () => {
    renderBar({ pending: true })
    expect(screen.getByRole('button', { name: /status/i })).toBeDisabled()
  })
})
