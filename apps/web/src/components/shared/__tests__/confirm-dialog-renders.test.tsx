// @vitest-environment happy-dom
/**
 * Lists keep a confirm dialog per row (remove a member, revoke an invite), all
 * closed, rendered with the row each time the list renders. A confirm dialog
 * has no trigger of its own, so until it is first asked for it renders none
 * of the alert dialog; once opened it stays mounted, as before.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { useState } from 'react'

let alertDialogRenders = 0
vi.mock('@/components/ui/alert-dialog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui/alert-dialog')>()
  return {
    ...actual,
    AlertDialog: (props: Parameters<typeof actual.AlertDialog>[0]) => {
      alertDialogRenders++
      return <actual.AlertDialog {...props} />
    },
  }
})

const { ConfirmDialog } = await import('../confirm-dialog')

afterEach(() => {
  cleanup()
  alertDialogRenders = 0
})

let setOpen: (open: boolean) => void = () => {}
let rerenderRow: () => void = () => {}

function Row() {
  const [open, setOpenState] = useState(false)
  const [, setVersion] = useState(0)
  setOpen = setOpenState
  rerenderRow = () => setVersion((v) => v + 1)
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpenState}
      title="Remove member?"
      confirmLabel="Remove"
      onConfirm={() => {}}
    />
  )
}

describe('ConfirmDialog renders', () => {
  it('renders no alert dialog until it is first opened', async () => {
    render(<Row />)
    act(() => rerenderRow())
    act(() => rerenderRow())
    expect(alertDialogRenders).toBe(0)
    expect(screen.queryByText('Remove member?')).not.toBeInTheDocument()

    await act(async () => setOpen(true))
    expect(await screen.findByRole('alertdialog', { name: 'Remove member?' })).toBeInTheDocument()

    await act(async () => setOpen(false))
    expect(screen.queryByText('Remove member?')).not.toBeInTheDocument()
    const afterClose = alertDialogRenders
    act(() => rerenderRow())
    expect(alertDialogRenders).toBe(afterClose + 1)

    await act(async () => setOpen(true))
    expect(await screen.findByRole('alertdialog', { name: 'Remove member?' })).toBeInTheDocument()
  })
})
