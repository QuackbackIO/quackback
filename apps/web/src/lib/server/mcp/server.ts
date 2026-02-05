/**
 * MCP Server Factory
 *
 * Creates an McpServer instance with all tools and resources registered.
 * Resources are inlined here (5 one-liner service calls).
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerTools } from './tools'
import type { McpAuthContext } from './types'

export function createMcpServer(auth: McpAuthContext): McpServer {
  const server = new McpServer({
    name: 'quackback',
    version: '1.0.0',
  })

  registerTools(server, auth)
  registerResources(server)

  return server
}

function registerResources(server: McpServer) {
  server.resource('boards', 'quackback://boards', { description: 'List all boards' }, async () => {
    const { listBoards } = await import('@/lib/server/domains/boards/board.service')
    const boards = await listBoards()
    return {
      contents: [
        {
          uri: 'quackback://boards',
          mimeType: 'application/json',
          text: JSON.stringify(
            boards.map((b) => ({ id: b.id, name: b.name, slug: b.slug })),
            null,
            2
          ),
        },
      ],
    }
  })

  server.resource(
    'statuses',
    'quackback://statuses',
    { description: 'List all statuses' },
    async () => {
      const { listStatuses } = await import('@/lib/server/domains/statuses/status.service')
      const statuses = await listStatuses()
      return {
        contents: [
          {
            uri: 'quackback://statuses',
            mimeType: 'application/json',
            text: JSON.stringify(
              statuses.map((s) => ({ id: s.id, name: s.name, slug: s.slug, color: s.color })),
              null,
              2
            ),
          },
        ],
      }
    }
  )

  server.resource('tags', 'quackback://tags', { description: 'List all tags' }, async () => {
    const { listTags } = await import('@/lib/server/domains/tags/tag.service')
    const tags = await listTags()
    return {
      contents: [
        {
          uri: 'quackback://tags',
          mimeType: 'application/json',
          text: JSON.stringify(
            tags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
            null,
            2
          ),
        },
      ],
    }
  })

  server.resource(
    'roadmaps',
    'quackback://roadmaps',
    { description: 'List all roadmaps' },
    async () => {
      const { listRoadmaps } = await import('@/lib/server/domains/roadmaps/roadmap.service')
      const roadmaps = await listRoadmaps()
      return {
        contents: [
          {
            uri: 'quackback://roadmaps',
            mimeType: 'application/json',
            text: JSON.stringify(
              roadmaps.map((r) => ({ id: r.id, name: r.name, slug: r.slug })),
              null,
              2
            ),
          },
        ],
      }
    }
  )

  server.resource(
    'members',
    'quackback://members',
    { description: 'List all team members (emails stripped)' },
    async () => {
      const { listTeamMembers } = await import('@/lib/server/domains/members/member.service')
      const members = await listTeamMembers()
      return {
        contents: [
          {
            uri: 'quackback://members',
            mimeType: 'application/json',
            text: JSON.stringify(
              members.map((m) => ({ id: m.id, name: m.name, role: m.role })),
              null,
              2
            ),
          },
        ],
      }
    }
  )
}
