// @vitest-environment happy-dom
/**
 * The create-post form is a lazy chunk. When it cannot load (the page was
 * left open across a deploy and the old chunk is gone), the failure stays in
 * the dialog: the Feedback list keeps rendering, the dialog closes, a toast
 * explains, and the next open tries the import again.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { IntlProvider } from 'react-intl'
import { createId } from '@quackback/ids'

const failure = vi.hoisted(
  () =>
    new TypeError(
      'Failed to fetch dynamically imported module: /assets/create-post-dialog-content-x.js'
    )
)
const imports = vi.hoisted(() => ({ count: 0 }))
const toastError = vi.hoisted(() => vi.fn())

vi.mock('../create-post-dialog-content', () => {
  imports.count++
  throw failure
})
vi.mock('@/lib/client/error-notice', () => ({ toastError }))

import { CreatePostDialog } from '../create-post-dialog'

afterEach(() => {
  cleanup()
  toastError.mockReset()
})

function renderPage() {
  return render(
    <IntlProvider locale="en" messages={{}} onError={() => {}}>
      <p>Feedback list</p>
      <CreatePostDialog
        boards={[{ id: createId('board'), name: 'Ideas', slug: 'ideas' } as never]}
        tags={[]}
        statuses={[{ id: createId('post_status'), name: 'Open', isDefault: true } as never]}
        currentUser={{ principalId: 'principal_1', name: 'Sam', email: 'sam@example.com' } as never}
      />
    </IntlProvider>
  )
}

describe('CreatePostDialog when its form cannot load', () => {
  it('keeps the page, closes the dialog, toasts, and retries on the next open', async () => {
    renderPage()
    const button = screen.getByRole('button', { name: 'New post' })

    await act(async () => fireEvent.click(button))
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1))
    // The real error (the browser's failed module fetch) is worded by describeError.
    expect(toastError).toHaveBeenCalledWith(expect.anything(), "Couldn't open the new post form")
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByText('Feedback list')).toBeTruthy()
    expect(button.getAttribute('aria-expanded')).toBe('false')

    const before = imports.count
    await act(async () => fireEvent.click(button))
    await waitFor(() => expect(toastError).toHaveBeenCalledTimes(2))
    expect(imports.count).toBeGreaterThan(before)
    expect(screen.getByText('Feedback list')).toBeTruthy()
  })

  it('a failed preload on hover or focus raises no unhandled rejection', async () => {
    const rejections: unknown[] = []
    const onRejection = (reason: unknown) => rejections.push(reason)
    process.on('unhandledRejection', onRejection)
    try {
      renderPage()
      const button = screen.getByRole('button', { name: 'New post' })
      fireEvent.pointerEnter(button)
      fireEvent.focus(button)
      await new Promise((resolve) => setTimeout(resolve, 50))
      expect(rejections).toEqual([])
      expect(toastError).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', onRejection)
    }
  })
})
