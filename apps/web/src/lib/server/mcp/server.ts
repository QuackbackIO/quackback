/**
 * MCP Server Factory
 *
 * Creates an McpServer instance with all tools and resources registered.
 * Resources are inlined here (5 one-liner service calls).
 */

import { McpServer, type ReadResourceCallback } from '@modelcontextprotocol/sdk/server/mcp.js'
import { registerTools } from './tools'
import type { McpAuthContext, McpScope } from './types'

export function createMcpServer(auth: McpAuthContext): McpServer {
  const server = new McpServer({
    name: 'quackback',
    version: '1.0.0',
  })

  registerTools(server, auth)
  registerResources(server, auth)

  return server
}

/** Wrap a resource callback with a scope check. */
function scopeGated(
  auth: McpAuthContext,
  scope: McpScope,
  fn: ReadResourceCallback
): ReadResourceCallback {
  return async (uri, extra) => {
    if (!auth.scopes.includes(scope)) {
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
    return fn(uri, extra)
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

function registerResources(server: McpServer, auth: McpAuthContext) {
  server.resource(
    'boards',
    'quackback://boards',
    { description: 'List all boards' },
    scopeGated(auth, 'read:feedback', async () => {
      const { listBoards } = await import('@/lib/server/domains/boards/board.service')
      const boards = await listBoards()
      return jsonResource(
        'boards',
        boards.map((b) => ({ id: b.id, name: b.name, slug: b.slug }))
      )
    })
  )

  server.resource(
    'statuses',
    'quackback://statuses',
    { description: 'List all statuses' },
    scopeGated(auth, 'read:feedback', async () => {
      const { listStatuses } = await import('@/lib/server/domains/statuses/status.service')
      const statuses = await listStatuses()
      return jsonResource(
        'statuses',
        statuses.map((s) => ({ id: s.id, name: s.name, slug: s.slug, color: s.color }))
      )
    })
  )

  server.resource(
    'tags',
    'quackback://tags',
    { description: 'List all tags' },
    scopeGated(auth, 'read:feedback', async () => {
      const { listTags } = await import('@/lib/server/domains/tags/tag.service')
      const tags = await listTags()
      return jsonResource(
        'tags',
        tags.map((t) => ({ id: t.id, name: t.name, color: t.color }))
      )
    })
  )

  server.resource(
    'roadmaps',
    'quackback://roadmaps',
    { description: 'List all roadmaps' },
    scopeGated(auth, 'read:feedback', async () => {
      const { listRoadmaps } = await import('@/lib/server/domains/roadmaps/roadmap.service')
      const roadmaps = await listRoadmaps()
      return jsonResource(
        'roadmaps',
        roadmaps.map((r) => ({ id: r.id, name: r.name, slug: r.slug }))
      )
    })
  )

  server.resource(
    'members',
    'quackback://members',
    { description: 'List all team members (emails stripped)' },
    scopeGated(auth, 'read:feedback', async () => {
      const { listTeamMembers } = await import('@/lib/server/domains/principals/principal.service')
      const members = await listTeamMembers()
      return jsonResource(
        'members',
        members.map((m) => ({ id: m.id, name: m.name, role: m.role }))
      )
    })
  )

  server.resource(
    'help-center-categories',
    'quackback://help-center/categories',
    { description: 'List all help center categories with article counts' },
    scopeGated(auth, 'read:article', async () => {
      const { isFeatureEnabled } = await import('@/lib/server/domains/settings/settings.service')
      if (!(await isFeatureEnabled('helpCenter'))) {
        return {
          contents: [
            {
              uri: 'quackback://help-center/categories',
              mimeType: 'text/plain',
              text: 'Help center is not enabled. Enable it in Settings > Features.',
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

  server.resource(
    'ticket-statuses',
    'quackback://ticket-statuses',
    { description: 'List all ticket workflow statuses (the workspace status catalogue)' },
    scopeGated(auth, 'read:tickets', async () => {
      const { listTicketStatuses } =
        await import('@/lib/server/domains/tickets/ticket-statuses.service')
      const statuses = await listTicketStatuses()
      return jsonResource(
        'ticket-statuses',
        statuses.map((s) => ({
          id: s.id,
          name: s.name,
          slug: s.slug,
          color: s.color,
          category: s.category,
          position: s.position,
          isDefault: s.isDefault,
          isSystem: s.isSystem,
        }))
      )
    })
  )

  server.resource(
    'tickets-inbox',
    'quackback://tickets/inbox',
    { description: "List up to 50 tickets in the caller's inbox queue (read:tickets)" },
    scopeGated(auth, 'read:tickets', async () => {
      try {
        const { listTickets } = await import('@/lib/server/domains/tickets/ticket.query')
        const { loadPermissionSet } = await import('@/lib/server/domains/authz/authz.service')
        const set = await loadPermissionSet(auth.principalId)
        const result = await listTickets({
          scope: 'my_inbox',
          permissionSet: set,
          limit: 50,
        })
        return jsonResource('tickets/inbox', {
          tickets: result.rows.map((t) => ({
            id: t.id,
            subject: t.subject,
            statusId: t.statusId,
            priority: t.priority,
            assigneePrincipalId: t.assigneePrincipalId,
            primaryTeamId: t.primaryTeamId,
            inboxId: t.inboxId,
            lastActivityAt: t.lastActivityAt,
            createdAt: t.createdAt,
          })),
          total: result.total,
        })
      } catch (err) {
        return {
          contents: [
            {
              uri: 'quackback://tickets/inbox',
              mimeType: 'text/plain',
              text: `Cannot list inbox tickets: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
        }
      }
    })
  )

  server.resource(
    'contacts',
    'quackback://contacts',
    { description: 'List up to 50 most recent contacts' },
    scopeGated(auth, 'read:contacts', async () => {
      const { searchContacts } = await import('@/lib/server/domains/organizations/contact.service')
      const rows = await searchContacts({ limit: 50 })
      return jsonResource(
        'contacts',
        rows.map((c) => ({
          id: c.id,
          name: c.name,
          email: c.email,
          organizationId: c.organizationId,
          externalId: c.externalId,
        }))
      )
    })
  )

  server.resource(
    'organizations',
    'quackback://organizations',
    { description: 'List up to 50 customer organizations' },
    scopeGated(auth, 'read:contacts', async () => {
      const { listOrganizations } =
        await import('@/lib/server/domains/organizations/organization.service')
      const rows = await listOrganizations({ limit: 50 })
      return jsonResource(
        'organizations',
        rows.map((o) => ({
          id: o.id,
          name: o.name,
          domain: o.domain,
          externalId: o.externalId,
          website: o.website,
        }))
      )
    })
  )
}
