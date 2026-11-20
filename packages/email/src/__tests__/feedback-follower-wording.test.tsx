/**
 * Status-change and new-comment emails go to everyone who follows a post:
 * its author, voters, commenters and people who subscribed by hand. Only the
 * author is told it is "your feedback"; everyone else reads about a post they
 * follow. A mention email's footer link turns off all email, so it says so.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render } from '@react-email/components'
import * as email from '../index'
import { PostMentionEmail } from '../templates/post-mention'
import { sealedTo } from './brands'

const resendSend = vi.hoisted(() => vi.fn())

vi.mock('resend', async (importOriginal) => {
  const actual = await importOriginal<typeof import('resend')>()
  return {
    ...actual,
    Resend: class {
      emails = { send: resendSend }
    },
  }
})

const ENV_KEYS = [
  'EMAIL_SES_ACCESS_KEY_ID',
  'EMAIL_SES_SECRET_ACCESS_KEY',
  'EMAIL_SMTP_HOST',
  'EMAIL_RESEND_API_KEY',
  'RESEND_API_KEY',
  'EMAIL_INBOUND_PROVIDER',
  'EMAIL_FROM',
] as const

const saved: Record<string, string | undefined> = {}
beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key]
    delete process.env[key]
  }
  process.env.EMAIL_RESEND_API_KEY = 're_test'
  process.env.EMAIL_FROM = 'noreply@platform.test'
  resendSend.mockReset()
  resendSend.mockResolvedValue({ data: { id: 'resend-email-id' }, error: null, headers: null })
})
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] !== undefined) process.env[key] = saved[key]
    else delete process.env[key]
  }
})

const sent = () => resendSend.mock.calls.at(-1)?.[0] as { subject: string; html: string }

/** The rendered HTML as text, without tags or the comment nodes React leaves between parts. */
function textOf(html: string): string {
  return html
    .replace(/<!--.*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ')
}

const status = (isPostAuthor?: boolean) =>
  email.sendStatusChangeEmail({
    to: sealedTo('sam@acme.test'),
    postTitle: 'Dark mode',
    postUrl: 'https://acme.test/b/f/posts/1',
    previousStatus: 'open',
    newStatus: 'planned',
    workspaceName: 'Acme',
    unsubscribeUrl: 'https://acme.test/unsubscribe?token=t',
    ...(isPostAuthor === undefined ? {} : { isPostAuthor }),
  })

const comment = (isPostAuthor?: boolean) =>
  email.sendNewCommentEmail({
    to: sealedTo('sam@acme.test'),
    postTitle: 'Dark mode',
    postUrl: 'https://acme.test/b/f/posts/1#comment-1',
    commenterName: 'Dana',
    commentPreview: 'me too',
    isTeamMember: false,
    workspaceName: 'Acme',
    unsubscribeUrl: 'https://acme.test/unsubscribe?token=t',
    ...(isPostAuthor === undefined ? {} : { isPostAuthor }),
  })

describe('status change email', () => {
  it('tells the author about their feedback', async () => {
    await status(true)
    expect(sent().subject).toBe('Your feedback is now planned!')
    const text = textOf(sent().html)
    expect(text).toContain('The status of your feedback has been updated')
    expect(text).toContain('because you submitted this feedback')
    expect(text).toContain('Unsubscribe from this post')
  })

  it('tells anyone else about a post they follow, never "your feedback"', async () => {
    await status(false)
    expect(sent().subject).toBe('A post you follow is now planned')
    const text = textOf(sent().html)
    expect(text).not.toMatch(/your feedback/i)
    expect(text).toContain('A post you follow is now Planned')
    expect(text).toContain('because you follow this post')
    expect(text).toContain('Unsubscribe from this post')
  })

  it('uses the follower wording when it is not told who the reader is', async () => {
    await status()
    expect(sent().subject).toBe('A post you follow is now planned')
    expect(textOf(sent().html)).not.toMatch(/your feedback/i)
  })
})

describe('new comment email', () => {
  it('tells the author someone commented on their feedback', async () => {
    await comment(true)
    expect(sent().subject).toBe('New comment on "Dark mode"')
    const text = textOf(sent().html)
    expect(text).toContain('Dana commented on your feedback in Acme')
    expect(text).toContain('because you submitted this feedback')
  })

  it('tells anyone else about a post they follow, never "your feedback"', async () => {
    await comment(false)
    expect(sent().subject).toBe('New comment on "Dark mode"')
    const text = textOf(sent().html)
    expect(text).not.toMatch(/your feedback/i)
    expect(text).toContain('Dana commented on a post you follow in Acme')
    expect(text).toContain('because you follow this post')
  })

  it('uses the follower wording when it is not told who the reader is', async () => {
    await comment()
    expect(textOf(sent().html)).not.toMatch(/your feedback/i)
  })
})

describe('post mention email', () => {
  it('labels its unsubscribe link as turning off all email', async () => {
    const html = await render(
      <PostMentionEmail
        mentionerName="Alex"
        postTitle="Dark mode"
        excerpt="Look"
        postUrl="https://acme.test/p/1"
        workspaceName="Acme"
        unsubscribeUrl="https://acme.test/unsubscribe?token=t"
      />
    )
    const text = textOf(html)
    expect(text).not.toContain('Unsubscribe from this post')
    expect(text).toContain('Turn off all email')
  })
})
