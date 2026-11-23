import { describe, expect, it } from 'vitest'
import { createId } from '@quackback/ids'
import { articleFeedbackSchema } from '../help-center'

describe('articleFeedbackSchema', () => {
  const vote = { articleId: 'kb_article_1', helpful: false }

  it('accepts a vote with no earlier vote to replace', () => {
    expect(articleFeedbackSchema.safeParse(vote).success).toBe(true)
  })

  it('accepts the id of the earlier vote it replaces', () => {
    const replacesFeedbackId = createId('kb_article_feedback')
    expect(articleFeedbackSchema.parse({ ...vote, replacesFeedbackId })).toEqual({
      ...vote,
      replacesFeedbackId,
    })
  })

  it('refuses a malformed id or an id of another kind', () => {
    for (const replacesFeedbackId of ['not-an-id', '', createId('kb_article')]) {
      expect(articleFeedbackSchema.safeParse({ ...vote, replacesFeedbackId }).success).toBe(false)
    }
  })
})
