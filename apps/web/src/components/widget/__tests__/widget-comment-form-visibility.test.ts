import { describe, expect, it } from 'vitest'
import { shouldShowWidgetCommentForm } from '../widget-post-detail'

describe('shouldShowWidgetCommentForm', () => {
  it('shows the editor for an identified user when verified identity is required', () => {
    expect(
      shouldShowWidgetCommentForm({
        isCommentsLocked: false,
        commentNoAccess: false,
        hmacRequired: true,
        isIdentified: true,
      })
    ).toBe(true)
  })

  it('keeps anonymous visitors read-only when verified identity is required', () => {
    expect(
      shouldShowWidgetCommentForm({
        isCommentsLocked: false,
        commentNoAccess: false,
        hmacRequired: true,
        isIdentified: false,
      })
    ).toBe(false)
  })

  it('does not show the editor when comments are locked or access is denied', () => {
    expect(
      shouldShowWidgetCommentForm({
        isCommentsLocked: true,
        commentNoAccess: false,
        hmacRequired: false,
        isIdentified: true,
      })
    ).toBe(false)
    expect(
      shouldShowWidgetCommentForm({
        isCommentsLocked: false,
        commentNoAccess: true,
        hmacRequired: false,
        isIdentified: true,
      })
    ).toBe(false)
  })
})
