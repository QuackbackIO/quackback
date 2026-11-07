// @vitest-environment happy-dom
/**
 * Someone who may edit the design but not publish it still sees what the
 * draft changes in the review, and is told why they cannot publish it.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { ReviewPublishDialog } from '../review-publish-dialog'

afterEach(cleanup)

const dialog = (canPublish: boolean) =>
  render(
    <ReviewPublishDialog
      open
      onOpenChange={() => {}}
      changes={[]}
      report={{ adjustments: [], errors: [] }}
      onPublish={async () => ({ ok: true })}
      canPublish={canPublish}
    />
  )

describe('the publish permission in the review', () => {
  it('lets someone who may publish publish', () => {
    dialog(true)
    expect(screen.getByRole('button', { name: 'Publish' }).hasAttribute('disabled')).toBe(false)
  })

  it('shows the review without publishing, and says why', () => {
    dialog(false)
    expect(screen.getByRole('button', { name: 'Publish' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('Publishing needs permission to publish the design.')).toBeTruthy()
  })
})
