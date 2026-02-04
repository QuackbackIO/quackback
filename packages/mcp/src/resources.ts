/**
 * MCP Resources for Quackback
 *
 * 5 resources providing reference data for grounding:
 * - boards: All feedback boards
 * - statuses: All feedback statuses
 * - tags: All tags
 * - roadmaps: All roadmaps
 * - members: Team members (without email for privacy)
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { api, type ApiConfig } from './api.js'
import type { ApiBoard, ApiStatus, ApiTag, ApiRoadmap, ApiMember, ApiResponse } from './types.js'

interface ResourceConfig {
  name: string
  description: string
  fetcher: () => Promise<unknown>
}

function registerResource(server: McpServer, apiConfig: ApiConfig, config: ResourceConfig) {
  const uri = `quackback://${config.name}`
  server.resource(
    config.name,
    uri,
    {
      description: config.description,
      mimeType: 'application/json',
    },
    async () => {
      const data = await config.fetcher()
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(data, null, 2),
          },
        ],
      }
    }
  )
}

export function registerResources(server: McpServer, apiConfig: ApiConfig) {
  registerResource(server, apiConfig, {
    name: 'boards',
    description:
      'All feedback boards with id, name, slug, description, isPublic, postCount. Use board IDs when creating posts or filtering searches.',
    fetcher: async () => {
      const res = await api<ApiResponse<ApiBoard[]>>(apiConfig, '/boards')
      return res.data
    },
  })

  registerResource(server, apiConfig, {
    name: 'statuses',
    description:
      'All feedback statuses with id, name, slug, color, category (active/complete/closed), isDefault, showOnRoadmap. Use status IDs when triaging posts.',
    fetcher: async () => {
      const res = await api<ApiResponse<ApiStatus[]>>(apiConfig, '/statuses')
      return res.data
    },
  })

  registerResource(server, apiConfig, {
    name: 'tags',
    description:
      'All tags with id, name, color. Use tag IDs when triaging posts or filtering searches.',
    fetcher: async () => {
      const res = await api<ApiResponse<ApiTag[]>>(apiConfig, '/tags')
      return res.data
    },
  })

  registerResource(server, apiConfig, {
    name: 'roadmaps',
    description: 'All roadmaps with id, name, slug, isPublic.',
    fetcher: async () => {
      const res = await api<ApiResponse<ApiRoadmap[]>>(apiConfig, '/roadmaps')
      return res.data
    },
  })

  registerResource(server, apiConfig, {
    name: 'members',
    description: 'Team members with id, name, role. Use member IDs when assigning post owners.',
    fetcher: async () => {
      const res = await api<ApiResponse<ApiMember[]>>(apiConfig, '/members')
      // Strip emails for privacy - only return id, name, role
      return res.data.map(({ id, name, role }) => ({ id, name, role }))
    },
  })
}
