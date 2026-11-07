/**
 * The emails a visitor gets about what they posted call it a post, as the
 * portal does: never an idea, and never their feedback once it is a post.
 */
import { describe, expect, it } from 'vitest'
import { render } from '@react-email/components'
import { StatusChangeEmail } from '../templates/status-change'
import { NewCommentEmail } from '../templates/new-comment'
import { PostMentionEmail } from '../templates/post-mention'
import { FeedbackLinkedEmail } from '../templates/feedback-linked'
import { statusChangeSubject } from '../index'

/** An email as its plain-text part reads, spaces collapsed and in lower case (headings are capitals there). */
const text = async (email: React.ReactElement) =>
  (await render(email, { plainText: true })).replace(/\s+/g, ' ').toLowerCase()

describe('emails about what a visitor posted', () => {
  it('say post in the status email and its subject', async () => {
    const plain = await text(
      <StatusChangeEmail
        postTitle="Dark mode"
        postUrl="https://example.com/p/1"
        previousStatus="open"
        newStatus="planned"
        organizationName="Acme"
        unsubscribeUrl="https://example.com/u"
      />
    )
    expect(plain).toContain('your post is now planned!')
    expect(plain).toContain('the status of your post has been updated on acme.')
    expect(plain).toContain('view post')
    expect(plain).toContain('subscribed to this post.')
    expect(plain).not.toMatch(/feedback|idea/)
    expect(statusChangeSubject('in_progress')).toBe('Your post is now in progress!')
  })

  it('say post in the comment, mention and linked emails', async () => {
    const comment = await text(
      <NewCommentEmail
        postTitle="Dark mode"
        postUrl="https://example.com/p/1"
        commenterName="Ada"
        commentPreview="Yes please"
        isTeamMember={false}
        organizationName="Acme"
        unsubscribeUrl="https://example.com/u"
      />
    )
    expect(comment).toContain('new comment on your post')
    expect(comment).toContain('commented on your post in acme')
    expect(comment).not.toMatch(/feedback|idea/)

    const mention = await text(
      <PostMentionEmail
        mentionerName="Ada"
        postTitle="Dark mode"
        excerpt=""
        postUrl="https://example.com/p/1"
        workspaceName="Acme"
      />
    )
    expect(mention).toContain('view post')
    expect(mention).not.toMatch(/feedback|idea/)

    const linked = await text(
      <FeedbackLinkedEmail
        recipientName="Ada"
        postTitle="Dark mode"
        postUrl="https://example.com/p/1"
        workspaceName="Acme"
        unsubscribeUrl="https://example.com/u"
      />
    )
    expect(linked).toContain('your feedback has been linked to a post on acme.')
    expect(linked).toContain('view post')
    expect(linked).not.toMatch(/idea/)
  })
})
