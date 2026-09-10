// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ConfirmDialog } from '../confirm-dialog'

describe('ConfirmDialog', () => {
  it('keeps the dialog open for an async confirm and ignores a second click', async () => {
    let resolveConfirm: (() => void) | undefined
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveConfirm = resolve
        })
    )
    const onOpenChange = vi.fn()

    render(
      <ConfirmDialog
        open
        onOpenChange={onOpenChange}
        title="Rotate?"
        confirmLabel="Rotate now"
        onConfirm={onConfirm}
      />
    )

    const confirm = screen.getByRole('button', { name: 'Rotate now' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)

    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(confirm).toBeDisabled()

    resolveConfirm?.()
    await waitFor(() => {
      expect(confirm).not.toBeDisabled()
    })
  })

  it('does not reject when the async confirm fails', async () => {
    const onConfirm = vi.fn(() => Promise.reject(new Error('nope')))

    render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="Rotate?"
        confirmLabel="Rotate now"
        onConfirm={onConfirm}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Rotate now' }))
    await waitFor(() => {
      expect(onConfirm).toHaveBeenCalledOnce()
    })
    expect(screen.getByText('Rotate?')).toBeInTheDocument()
  })

  it('lets a sync confirm close the dialog', () => {
    const onConfirm = vi.fn()

    render(
      <ConfirmDialog
        open
        onOpenChange={vi.fn()}
        title="Delete?"
        confirmLabel="Delete"
        onConfirm={onConfirm}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })
})
