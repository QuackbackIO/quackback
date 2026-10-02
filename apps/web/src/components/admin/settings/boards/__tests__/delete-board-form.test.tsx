// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import type { BoardId } from '@quackback/ids'

const toastError = vi.fn()
vi.mock('sonner', () => ({ toast: { error: (m: string) => toastError(m) } }))

const mutate = vi.fn()
vi.mock('@/lib/client/mutations', () => ({
  useDeleteBoard: () => ({ mutate, isPending: false }),
}))

const navigate = vi.fn()
const invalidate = vi.fn()
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  useRouter: () => ({ invalidate }),
}))

import { DeleteBoardForm } from '../delete-board-form'

const board = { id: 'board_01test' as BoardId, name: 'Bug Reports', slug: 'bugs' }

beforeEach(() => {
  mutate.mockReset()
  navigate.mockReset()
  invalidate.mockReset()
})
afterEach(cleanup)

describe('<DeleteBoardForm>', () => {
  it('shows one delete button and no type-to-confirm field until asked', () => {
    render(<DeleteBoardForm board={board} />)
    expect(screen.getByRole('button', { name: 'Delete board' })).toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Bug Reports')).toBeNull()
  })

  it('keeps Delete board disabled in the dialog until the name is typed', () => {
    render(<DeleteBoardForm board={board} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete board' }))
    expect(screen.getByText('Delete board?')).toBeInTheDocument()

    const confirm = screen.getAllByRole('button', { name: 'Delete board' }).at(-1)!
    expect(confirm).toBeDisabled()

    fireEvent.change(screen.getByPlaceholderText('Bug Reports'), { target: { value: 'Bug' } })
    expect(confirm).toBeDisabled()
    fireEvent.change(screen.getByPlaceholderText('Bug Reports'), {
      target: { value: 'Bug Reports' },
    })
    expect(confirm).not.toBeDisabled()
  })

  it('deletes the board and returns to the list once the name matches', () => {
    render(<DeleteBoardForm board={board} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete board' }))
    fireEvent.change(screen.getByPlaceholderText('Bug Reports'), {
      target: { value: 'Bug Reports' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete board' }).at(-1)!)

    expect(mutate).toHaveBeenCalledTimes(1)
    expect(mutate.mock.calls[0]![0]).toEqual({ id: board.id })
    const opts = mutate.mock.calls[0]![1] as { onSuccess: () => void }
    act(() => opts.onSuccess())
    expect(navigate).toHaveBeenCalledWith({ to: '/admin/settings/boards', search: {} })
    expect(invalidate).toHaveBeenCalled()
  })

  it('never deletes when the name does not match', () => {
    render(<DeleteBoardForm board={board} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete board' }))
    fireEvent.change(screen.getByPlaceholderText('Bug Reports'), { target: { value: 'nope' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete board' }).at(-1)!)
    expect(mutate).not.toHaveBeenCalled()
  })

  it('says so when the delete fails', () => {
    render(<DeleteBoardForm board={board} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete board' }))
    fireEvent.change(screen.getByPlaceholderText('Bug Reports'), {
      target: { value: 'Bug Reports' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete board' }).at(-1)!)
    const opts = mutate.mock.calls[0]![1] as { onError: () => void }
    act(() => opts.onError())
    expect(toastError).toHaveBeenCalledWith("Couldn't delete the board. Try again.")
  })
})
