import { describe, expect, it } from 'vitest'
import '../schemas'
import { generateOpenAPISpec } from '../openapi'

describe('writable tickets/conversations/moderation OpenAPI contract', () => {
  const spec = generateOpenAPISpec()
  const paths = spec.paths ?? {}

  it('registers the ticket write routes with the right methods', () => {
    expect(paths['/tickets']).toHaveProperty('post')
    expect(paths['/tickets']).toHaveProperty('get')
    expect(paths['/ticket-statuses']).toHaveProperty('get')
    for (const action of ['reply', 'note', 'status', 'assign', 'priority']) {
      expect(paths[`/tickets/{ticketId}/${action}`]).toHaveProperty('post')
    }
  })

  it('registers the conversation write routes; tags carries post + delete', () => {
    for (const action of ['reply', 'note', 'status', 'assign', 'priority', 'read']) {
      expect(paths[`/conversations/{conversationId}/${action}`]).toHaveProperty('post')
    }
    const tags = paths['/conversations/{conversationId}/tags']
    expect(tags).toHaveProperty('post')
    expect(tags).toHaveProperty('delete')
  })

  it('registers the moderation routes', () => {
    expect(paths['/moderation/pending']).toHaveProperty('get')
    expect(paths['/moderation/posts/{postId}/approve']).toHaveProperty('post')
    expect(paths['/moderation/posts/{postId}/reject']).toHaveProperty('post')
    expect(paths['/moderation/comments/{commentId}/approve']).toHaveProperty('post')
    expect(paths['/moderation/comments/{commentId}/reject']).toHaveProperty('post')
  })

  it('exposes the documented required request-body fields', () => {
    const createBody = JSON.stringify(
      // oxlint-disable-next-line @typescript-eslint/no-explicit-any
      (paths['/tickets'] as any).post.requestBody.content['application/json'].schema
    )
    expect(createBody).toContain('type')
    expect(createBody).toContain('title')

    const statusBody = JSON.stringify(
      // oxlint-disable-next-line @typescript-eslint/no-explicit-any
      (paths['/tickets/{ticketId}/status'] as any).post.requestBody.content['application/json']
        .schema
    )
    expect(statusBody).toContain('statusId')

    const convStatusBody = JSON.stringify(
      // oxlint-disable-next-line @typescript-eslint/no-explicit-any
      (paths['/conversations/{conversationId}/status'] as any).post.requestBody.content[
        'application/json'
      ].schema
    )
    expect(convStatusBody).toContain('status')

    const tagBody = JSON.stringify(
      // oxlint-disable-next-line @typescript-eslint/no-explicit-any
      (paths['/conversations/{conversationId}/tags'] as any).post.requestBody.content[
        'application/json'
      ].schema
    )
    expect(tagBody).toContain('tagId')
  })

  it('retitles the Tickets tag and adds a Moderation tag', () => {
    const tickets = spec.tags?.find((t) => t.name === 'Tickets')
    expect(tickets?.description).toBe('Manage support tickets')
    expect(spec.tags?.map((t) => t.name)).toContain('Moderation')
  })

  it('registers POST /files, with a Files tag', () => {
    expect(paths['/files']).toHaveProperty('post')
    expect(spec.tags?.map((t) => t.name)).toContain('Files')
  })

  it('documents the upload-then-attach flow with a real fileId example, not a server-rejected URL', () => {
    const replyBody = JSON.stringify(
      // oxlint-disable-next-line @typescript-eslint/no-explicit-any
      (paths['/conversations/{conversationId}/reply'] as any).post.requestBody.content[
        'application/json'
      ].schema
    )
    expect(replyBody).toContain('fileId')
    // The old example URL is one the server would reject outright (not a
    // trusted/stored URL): the documented example must not point at it.
    expect(replyBody).not.toContain('cdn.example.com')

    const ticketReplyBody = JSON.stringify(
      // oxlint-disable-next-line @typescript-eslint/no-explicit-any
      (paths['/tickets/{ticketId}/reply'] as any).post.requestBody.content['application/json']
        .schema
    )
    expect(ticketReplyBody).toContain('fileId')
    expect(ticketReplyBody).not.toContain('cdn.example.com')
  })
})
