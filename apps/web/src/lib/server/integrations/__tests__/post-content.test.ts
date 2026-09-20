import { describe, expect, it } from 'vitest'
import { buildIntegrationPostContent } from '../post-content'
import { buildLinearIssueBody } from '@/integrations/linear/server/message'
import { buildGitHubIssueBody } from '@/integrations/github/server/message'
import { buildGitLabIssue } from '@/integrations/gitlab/server/message'
import { buildTrelloCard } from '@/integrations/trello/server/message'
import { buildShortcutStoryBody } from '@/integrations/shortcut/server/message'
import { buildClickUpTaskBody } from '@/integrations/clickup/server/message'
import type { PostCreatedEvent } from '@/lib/server/events/types'
const root = 'https://feedback.test'
const url = `${root}/api/storage/shot.png`
const image = `![Screenshot](${url})`
const content =
  'a'.repeat(1997 - (image.length - 1)) + '![Screenshot](/api/storage/shot.png) trailing'
const event: PostCreatedEvent = {
  id: 'event',
  type: 'post.created',
  timestamp: new Date().toISOString(),
  actor: { type: 'service' },
  data: {
    post: {
      id: 'post',
      boardId: 'board',
      boardSlug: 'bugs',
      title: 'Title',
      voteCount: 1,
      content,
    },
  },
}
describe('shared integration media content', () => {
  it.each([
    ['Linear', (e: PostCreatedEvent) => buildLinearIssueBody(e, root).description],
    ['GitHub', (e: PostCreatedEvent) => buildGitHubIssueBody(e, root).body],
    ['GitLab', (e: PostCreatedEvent) => buildGitLabIssue(e, root).description],
    ['Trello', (e: PostCreatedEvent) => buildTrelloCard(e, root).desc],
    ['Shortcut', (e: PostCreatedEvent) => buildShortcutStoryBody(e, root).description],
    ['ClickUp', (e: PostCreatedEvent) => buildClickUpTaskBody(e, root).description],
  ] as const)('%s preserves an image cut at the closing parenthesis', (_provider, build) => {
    const body = build(event)
    expect(body).toContain(image)
    expect(body.split(url)).toHaveLength(2)
    expect(body).toContain('**Attachments**')
  })
  it('preserves late HTML media and does not duplicate complete inline media', () => {
    const body = buildIntegrationPostContent(
      `${image}\n${'x'.repeat(2200)}<video src="/clip.mp4"></video>`,
      root
    )
    expect(body.split(url)).toHaveLength(2)
    expect(body).toContain(`[Video: clip.mp4](${root}/clip.mp4)`)
    expect(body).not.toContain(`![Video:`)
  })
  it('lets Linear opt into its video ingestion syntax', () => {
    expect(buildIntegrationPostContent('[clip](/clip.mp4)', root, { embedVideos: true })).toBe(
      `![Video: clip](${root}/clip.mp4)`
    )
  })
})
