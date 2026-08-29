// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { PostingToBoard } from '../posting-to-board'

vi.mock('@/components/ui/select', async () => import('@/test/radix-select'))

const boards = [
  { id: 'board_1', name: 'Feature Requests', slug: 'features' },
  { id: 'board_2', name: 'Bug Reports', slug: 'bugs' },
]

function renderRow(locked: boolean) {
  const onSelect = vi.fn()
  const result = render(
    <IntlProvider locale="en" defaultLocale="en">
      <PostingToBoard
        boards={boards}
        selectedBoardId="board_1"
        locked={locked}
        onSelect={onSelect}
      />
    </IntlProvider>
  )
  return { onSelect, ...result }
}

describe('PostingToBoard', () => {
  it('renders a board switcher when the board is not locked', () => {
    renderRow(false)
    expect(screen.getByLabelText('Posting to Feature Requests')).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toHaveValue('board_1')
  })

  it('renders a static board name when the board is locked', () => {
    renderRow(true)
    expect(screen.getByLabelText('Posting to Feature Requests')).toBeInTheDocument()
    expect(screen.getByText('Feature Requests')).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })
})
