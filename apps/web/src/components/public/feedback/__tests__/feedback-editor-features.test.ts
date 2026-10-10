import { describe, expect, it } from 'vitest'
import { PUBLIC_FEEDBACK_EDITOR_FEATURES } from '../feedback-editor-features'

describe('public feedback editor preset', () => {
  it('offers heading formatting in the public composer', () => {
    expect(PUBLIC_FEEDBACK_EDITOR_FEATURES.headings).toBe(true)
  })
})
