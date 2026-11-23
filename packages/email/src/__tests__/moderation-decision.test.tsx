import { describe, it, expect } from 'vitest'
import { render } from '@react-email/components'
import {
  ModerationDecisionEmail,
  moderationDecisionHeadline,
} from '../templates/moderation-decision'

const base = {
  postTitle: 'Dark mode please',
  workspaceName: 'Acme',
  unsubscribeUrl: 'https://acme.test/unsubscribe?token=t',
}

describe('ModerationDecisionEmail', () => {
  it('tells the author their post is public and links to it', async () => {
    const html = await render(
      <ModerationDecisionEmail
        {...base}
        item="post"
        decision="approved"
        postUrl="https://acme.test/b/ideas/posts/post_1"
      />
    )
    expect(html).toContain('Your post is now public')
    expect(html).toContain('The Acme team reviewed your post and published it.')
    expect(html).toContain('Dark mode please')
    expect(html).toContain('https://acme.test/b/ideas/posts/post_1')
    expect(html).toContain('View post')
  })

  it('tells the author their post was not published, with no link', async () => {
    const html = await render(<ModerationDecisionEmail {...base} item="post" decision="rejected" />)
    expect(html).toContain('Your post was not published')
    expect(html).toContain('decided not to publish it')
    expect(html).not.toContain('View post')
  })

  it('words a comment as a comment on the post', async () => {
    const html = await render(
      <ModerationDecisionEmail
        {...base}
        item="comment"
        decision="approved"
        postUrl="https://acme.test/b/ideas/posts/post_1#comment-c1"
      />
    )
    expect(html).toContain('Your comment is now public')
    expect(html).toContain('reviewed your comment on this post')
    expect(html).toContain('View comment')
  })

  it('never says idea and uses no em dash', () => {
    for (const item of ['post', 'comment'] as const) {
      for (const decision of ['approved', 'rejected'] as const) {
        const headline = moderationDecisionHeadline(item, decision)
        expect(headline).not.toMatch(/idea/i)
        expect(headline).not.toContain('—')
      }
    }
  })
})
