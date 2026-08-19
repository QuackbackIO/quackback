import { describe, it, expect } from 'vitest'
import { postComments, postCommentEditHistory } from '../schema/posts'

describe('postComments.contentJson column', () => {
  it('is exposed on the schema (mirrors posts.contentJson for the rich editor)', () => {
    const col = (postComments as unknown as Record<string, unknown>).contentJson
    expect(col).toBeDefined()
  })
})

describe('postCommentEditHistory.previousContentJson column', () => {
  it('is exposed on the schema (mirrors postEditHistory.previousContentJson)', () => {
    const col = (postCommentEditHistory as unknown as Record<string, unknown>).previousContentJson
    expect(col).toBeDefined()
  })
})
