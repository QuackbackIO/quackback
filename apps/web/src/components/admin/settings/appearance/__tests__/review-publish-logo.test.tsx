// @vitest-environment happy-dom
/**
 * When the portal's logo is new, Review and publish offers to use it in the
 * admin and emails too, unticked; otherwise it says nothing about the logo.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ReviewPublishDialog } from '../review-publish-dialog'

afterEach(cleanup)

const LABEL = 'Also use the new logo in the admin and emails'

function show(newLogo: boolean) {
  const onPublish = vi.fn(async () => ({ ok: true as const }))
  render(
    <ReviewPublishDialog
      open
      onOpenChange={() => {}}
      changes={[]}
      report={{ adjustments: [], errors: [] }}
      onPublish={onPublish}
      canPublish
      newLogo={newLogo}
    />
  )
  return onPublish
}

describe('the workspace logo choice at publish', () => {
  it('is not offered when the portal logo is unchanged', async () => {
    const onPublish = show(false)
    expect(screen.queryByLabelText(LABEL)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Publish/ }))
    await waitFor(() => expect(onPublish).toHaveBeenCalledWith(undefined, { workspaceLogo: false }))
  })

  it('is offered unticked for a new logo, and sent once ticked', async () => {
    const onPublish = show(true)
    const box = screen.getByLabelText(LABEL)
    expect(box.getAttribute('aria-checked')).toBe('false')
    fireEvent.click(box)
    fireEvent.click(screen.getByRole('button', { name: /^Publish/ }))
    await waitFor(() => expect(onPublish).toHaveBeenCalledWith(undefined, { workspaceLogo: true }))
  })
})
