/**
 * MCP Server Factory
 *
 * Creates an McpServer instance with all tools and resources registered.
 * Resources are inlined here (one service call each).
 */

import { McpServer, type ReadResourceCallback } from '@modelcontextprotocol/server'
import { hasApiScope } from '@/lib/server/domains/api-keys/api-key-scopes'
import { RESOURCE_SCOPES } from './required-scope'
import { registerTools } from './tools'
import type { McpAuthContext, McpScope } from './types'
import { MCP_SERVER_INSTRUCTIONS } from './untrusted'

type ResourceUri = keyof typeof RESOURCE_SCOPES

/**
 * How long a 2026-07-28 client may reuse a cacheable result (`ttlMs`). The
 * tool and resource lists and the discover result only change when a new
 * version is deployed, and every caller gets the same list, so five minutes
 * costs at most a few minutes' lag after an upgrade while sparing clients a
 * list fetch (57 KB of tools) per conversation. Resource reads return live
 * workspace data (boards, statuses, members) that an admin can edit at any
 * time, so they keep a short minute. Every hint is `private`: the endpoint is
 * authenticated and each instance serves one workspace, so no shared cache
 * should hold a result. 2025-era responses never carry these fields.
 */
const LIST_TTL_MS = 5 * 60 * 1000
const READ_TTL_MS = 60 * 1000

export const MCP_CACHE_HINTS = {
  'server/discover': { ttlMs: LIST_TTL_MS, cacheScope: 'private' },
  'tools/list': { ttlMs: LIST_TTL_MS, cacheScope: 'private' },
  'resources/list': { ttlMs: LIST_TTL_MS, cacheScope: 'private' },
  'resources/templates/list': { ttlMs: LIST_TTL_MS, cacheScope: 'private' },
  'resources/read': { ttlMs: READ_TTL_MS, cacheScope: 'private' },
} as const

/** The app version, reported as `serverInfo.version`; `dev` outside a build. */
export function mcpServerVersion(): string {
  return typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'dev'
}

export function createMcpServer(auth: McpAuthContext): McpServer {
  const server = new McpServer(
    { name: 'quackback', version: mcpServerVersion() },
    {
      instructions: MCP_SERVER_INSTRUCTIONS,
      cacheHints: MCP_CACHE_HINTS,
      // The lists only change on deploy and every request is served stateless,
      // so there is never a change to announce. Saying so keeps 2026 clients
      // from holding a `subscriptions/listen` stream open for nothing.
      capabilities: { tools: { listChanged: false }, resources: { listChanged: false } },
    }
  )

  registerTools(server, auth)
  registerResources(server, auth)

  return server
}

/**
 * Wrap a resource callback with a scope check. The required scope comes
 * from RESOURCE_SCOPES so the handler gate and the OAuth 403 map stay
 * the same entry.
 */
function scopeGated(
  auth: McpAuthContext,
  resourceUri: ResourceUri,
  fn: ReadResourceCallback
): ReadResourceCallback {
  const scope: McpScope = RESOURCE_SCOPES[resourceUri]
  return async (uri, ctx) => {
    if (!hasApiScope(auth.scopes, scope)) {
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'text/plain',
            text: `Error: Insufficient scope. Required: ${scope}`,
          },
        ],
      }
    }
    return fn(uri, ctx)
  }
}

/** Build a JSON resource result for a quackback:// URI. */
function jsonResource(name: string, data: unknown): Awaited<ReturnType<ReadResourceCallback>> {
  return {
    contents: [
      {
        uri: `quackback://${name}`,
        mimeType: 'application/json',
        text: JSON.stringify(data, null, 2),
      },
    ],
  }
}

export function registerResources(server: McpServer, auth: McpAuthContext) {
  server.registerResource(
    'boards',
    'quackback://boards',
    { description: 'List all boards' },
    scopeGated(auth, 'quackback://boards', async () => {
      const { listBoards } = await import('@/lib/server/domains/boards/board.service')
      const boards = await listBoards()
      return jsonResource(
        'boards',
        boards.map((b) => ({ id: b.id, name: b.name, slug: b.slug }))
      )
    })
  )

  server.registerResource(
    'statuses',
    'quackback://statuses',
    { description: 'List all statuses' },
    scopeGated(auth, 'quackback://statuses', async () => {
      const { listStatuses } = await import('@/lib/server/domains/statuses/status.service')
      const statuses = await listStatuses()
      return jsonResource(
        'statuses',
        statuses.map((s) => ({ id: s.id, name: s.name, slug: s.slug, color: s.color }))
      )
    })
  )

  server.registerResource(
    'tags',
    'quackback://tags',
    { description: 'List all tags' },
    scopeGated(auth, 'quackback://tags', async () => {
      const { listPostTags } = await import('@/lib/server/domains/post-tags/post-tag.service')
      const tags = await listPostTags()
      return jsonResource(
        'tags',
        tags.map((t) => ({ id: t.id, name: t.name, color: t.color }))
      )
    })
  )

  server.registerResource(
    'roadmaps',
    'quackback://roadmaps',
    { description: 'List all roadmaps' },
    scopeGated(auth, 'quackback://roadmaps', async () => {
      const { listRoadmaps } = await import('@/lib/server/domains/roadmaps/roadmap.service')
      const roadmaps = await listRoadmaps()
      return jsonResource(
        'roadmaps',
        roadmaps.map((r) => ({ id: r.id, name: r.name, slug: r.slug }))
      )
    })
  )

  server.registerResource(
    'members',
    'quackback://members',
    { description: 'List all team members (emails stripped)' },
    scopeGated(auth, 'quackback://members', async () => {
      const { listTeamMembers } = await import('@/lib/server/domains/principals/principal.service')
      const members = await listTeamMembers()
      return jsonResource(
        'members',
        members.map((m) => ({ id: m.id, name: m.name, role: m.role }))
      )
    })
  )

  server.registerResource(
    'help-center-categories',
    'quackback://help-center/categories',
    { description: 'List all help center categories with article counts' },
    scopeGated(auth, 'quackback://help-center/categories', async () => {
      const { isFeatureEnabled } = await import('@/lib/server/domains/settings/settings.service')
      if (!(await isFeatureEnabled('helpCenter'))) {
        return {
          contents: [
            {
              uri: 'quackback://help-center/categories',
              mimeType: 'text/plain',
              text: 'Help center is not enabled. Enable it in Settings → General.',
            },
          ],
        }
      }
      // Team-only, matching the article search/get_details tools: the raw
      // category list includes private and segment-gated categories, which
      // must not leak to an OAuth portal user holding the read:article scope.
      const { isTeamMember } = await import('@/lib/shared/roles')
      if (!isTeamMember(auth.role)) {
        return {
          contents: [
            {
              uri: 'quackback://help-center/categories',
              mimeType: 'text/plain',
              text: 'Error: This resource requires a team member (admin or member) role.',
            },
          ],
        }
      }
      const { listCategories } =
        await import('@/lib/server/domains/help-center/help-center.service')
      const categories = await listCategories()
      return jsonResource(
        'help-center/categories',
        categories.map((c) => ({
          id: c.id,
          slug: c.slug,
          name: c.name,
          description: c.description,
          icon: c.icon,
          parentId: c.parentId,
          isPublic: c.isPublic,
          position: c.position,
          articleCount: c.articleCount,
        }))
      )
    })
  )
}
