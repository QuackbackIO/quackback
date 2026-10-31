/**
 * The emails a visitor gets about what they posted name it in the portal's
 * word: idea unless the workspace chose another.
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
  it('say idea by default, never feedback or post', async () => {
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
    expect(plain).toContain('your idea is now planned!')
    expect(plain).toContain('the status of your idea has been updated on acme.')
    expect(plain).toContain('view idea')
    expect(plain).toContain('subscribed to this idea.')
    expect(plain).not.toMatch(/feedback/i)
  })

  it('say the chosen word in each one', async () => {
    const status = await text(
      <StatusChangeEmail
        postTitle="Dark mode"
        postUrl="https://example.com/p/1"
        previousStatus="open"
        newStatus="planned"
        organizationName="Acme"
        unsubscribeUrl="https://example.com/u"
        postWord="suggestion"
      />
    )
    expect(status).toContain('your suggestion is now planned!')
    expect(statusChangeSubject('in_progress', 'feature_request')).toBe(
      'Your feature request is now in progress!'
    )

    const comment = await text(
      <NewCommentEmail
        postTitle="Dark mode"
        postUrl="https://example.com/p/1"
        commenterName="Ada"
        commentPreview="Yes please"
        isTeamMember={false}
        organizationName="Acme"
        unsubscribeUrl="https://example.com/u"
        postWord="post"
      />
    )
    expect(comment).toContain('new comment on your post')
    expect(comment).toContain('commented on your post in acme')
    expect(comment).not.toMatch(/feedback/i)

    const mention = await text(
      <PostMentionEmail
        mentionerName="Ada"
        postTitle="Dark mode"
        excerpt=""
        postUrl="https://example.com/p/1"
        workspaceName="Acme"
        postWord="feature_request"
      />
    )
    expect(mention).toContain('feature request')
    expect(mention).toContain('view feature request')

    const linked = await text(
      <FeedbackLinkedEmail
        recipientName="Ada"
        postTitle="Dark mode"
        postUrl="https://example.com/p/1"
        workspaceName="Acme"
        unsubscribeUrl="https://example.com/u"
        postWord="idea"
      />
    )
    expect(linked).toContain('your feedback has been linked to an idea on acme.')
    expect(linked).toContain('view idea')
  })
})
