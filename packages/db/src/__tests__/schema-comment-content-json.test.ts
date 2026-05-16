import { describe, it, expect } from 'vitest'
import { comments, commentEditHistory } from '../schema/posts'

describe('comments.contentJson column', () => {
  it('is exposed on the schema (mirrors posts.contentJson for the rich editor)', () => {
    const col = (comments as unknown as Record<string, unknown>).contentJson
    expect(col).toBeDefined()
  })
})

describe('commentEditHistory.previousContentJson column', () => {
  it('is exposed on the schema (mirrors postEditHistory.previousContentJson)', () => {
    const col = (commentEditHistory as unknown as Record<string, unknown>).previousContentJson
    expect(col).toBeDefined()
  })
})
