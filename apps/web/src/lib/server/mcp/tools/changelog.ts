/**
 * Changelog tools: create, update (incl. publish lifecycle + display date),
 * and soft delete.
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  createChangelog,
  updateChangelog,
  deleteChangelog,
} from '@/lib/server/domains/changelog/changelog.service'
import { publishedAtToPublishState, type PublishState } from '@/lib/shared/schemas/changelog'
import type { PostId, ChangelogId } from '@quackback/ids'
import type { McpAuthContext } from '../types'
import {
  registerTool,
  jsonResult,
  WRITE,
  DESTRUCTIVE,
  CONTENT_FORMAT_BLOCK,
  CONTENT_FIELD_DESCRIBE,
} from './helpers'

// ============================================================================
// Schemas
// ============================================================================

const createChangelogSchema = {
  title: z.string().max(200).describe('Changelog entry title'),
  content: z
    .string()
    .max(50000)
    .describe(`Changelog content (max 50,000 characters). ${CONTENT_FIELD_DESCRIBE}`),
  publish: z
    .boolean()
    .default(false)
    .describe('Set to true to publish immediately. Defaults to draft.'),
  publishedAt: z
    .string()
    .optional()
    .describe(
      'ISO 8601 datetime to publish at (e.g. "2025-03-15T12:00:00Z"). Overrides publish flag. Past dates backdate the entry, future dates schedule it.'
    ),
}

const updateChangelogSchema = {
  changelogId: z.string().describe('Changelog TypeID to update'),
  title: z.string().max(200).optional().describe('New title'),
  content: z
    .string()
    .max(50000)
    .optional()
    .describe(`New content (max 50,000 characters). ${CONTENT_FIELD_DESCRIBE}`),
  publish: z.boolean().optional().describe('Set to true to publish, false to revert to draft'),
  publishedAt: z
    .string()
    .optional()
    .describe(
      'ISO 8601 datetime for publish/schedule lifecycle (e.g. "2025-03-15T12:00:00Z"). Future dates schedule; past dates publish immediately. For display-only backdating on published entries, use displayDate instead.'
    ),
  displayDate: z
    .string()
    .nullable()
    .optional()
    .describe(
      'ISO 8601 portal display override for published entries. Null clears the override. Must not be in the future.'
    ),
  linkedPostIds: z
    .array(z.string())
    .optional()
    .describe('Replace linked posts with these post TypeIDs'),
}

const deleteChangelogSchema = {
  changelogId: z.string().describe('Changelog TypeID to delete'),
}

// ============================================================================
// Type aliases — manually defined to avoid deep Zod type recursion.
// WARNING: These must stay in sync with the Zod schemas above.
// If you add/remove/rename a field in a schema, update the matching type here.
// ============================================================================

type CreateChangelogArgs = {
  title: string
  content: string
  publish: boolean
  publishedAt?: string
}

type UpdateChangelogArgs = {
  changelogId: string
  title?: string
  content?: string
  publish?: boolean
  publishedAt?: string
  displayDate?: string | null
  linkedPostIds?: string[]
}

type DeleteChangelogArgs = { changelogId: string }

// ============================================================================
// Tool registration
// ============================================================================

export function registerChangelogTools(server: McpServer, auth: McpAuthContext) {
  registerTool<CreateChangelogArgs>(server, auth, {
    name: 'create_changelog',
    description: `Create a changelog entry. Saves as draft by default; set publish: true to publish immediately.

Examples:
- Draft: create_changelog({ title: "v2.1 Release", content: "## New features\\n- Dark mode..." })
- Published: create_changelog({ title: "v2.1 Release", content: "## New features\\n- Dark mode...", publish: true })
- Backdated: create_changelog({ title: "v2.1 Release", content: "...", publishedAt: "2025-03-15T12:00:00Z" })${CONTENT_FORMAT_BLOCK}`,
    schema: createChangelogSchema,
    annotations: WRITE,
    scope: 'write:changelog',
    teamOnly: true,
    handler: async (args) => {
      const publishState = args.publishedAt
        ? publishedAtToPublishState(args.publishedAt)
        : ({ type: args.publish ? 'published' : 'draft' } as const)
      const result = await createChangelog(
        {
          title: args.title,
          content: args.content,
          publishState,
        },
        { principalId: auth.principalId, name: auth.name }
      )

      return jsonResult({
        id: result.id,
        title: result.title,
        status: result.status,
        publishedAt: result.publishedAt,
        createdAt: result.createdAt,
      })
    },
  })

  registerTool<UpdateChangelogArgs>(server, auth, {
    name: 'update_changelog',
    description: `Update title, content, publish state, and/or linked posts on an existing changelog entry.

Examples:
- Update title: update_changelog({ changelogId: "changelog_01abc...", title: "v2.0 Release" })
- Publish: update_changelog({ changelogId: "changelog_01abc...", publish: true })
- Backdate display: update_changelog({ changelogId: "changelog_01abc...", displayDate: "2025-03-15T12:00:00Z" })
- Clear display override: update_changelog({ changelogId: "changelog_01abc...", displayDate: null })
- Link posts: update_changelog({ changelogId: "changelog_01abc...", linkedPostIds: ["post_01a...", "post_01b..."] })${CONTENT_FORMAT_BLOCK}`,
    schema: updateChangelogSchema,
    annotations: WRITE,
    scope: 'write:changelog',
    teamOnly: true,
    handler: async (args) => {
      let publishState: PublishState | undefined
      if (args.publishedAt !== undefined) {
        publishState = publishedAtToPublishState(args.publishedAt)
      } else if (args.publish === true) {
        publishState = { type: 'published' }
      } else if (args.publish === false) {
        publishState = { type: 'draft' }
      }

      const result = await updateChangelog(args.changelogId as ChangelogId, {
        title: args.title,
        content: args.content,
        linkedPostIds: args.linkedPostIds as PostId[] | undefined,
        publishState,
        ...(args.displayDate !== undefined && {
          displayDate: args.displayDate === null ? null : new Date(args.displayDate),
        }),
      })

      return jsonResult({
        id: result.id,
        title: result.title,
        status: result.status,
        publishedAt: result.publishedAt,
        displayDate: result.displayDate,
        updatedAt: result.updatedAt,
      })
    },
  })

  registerTool<DeleteChangelogArgs>(server, auth, {
    name: 'delete_changelog',
    description: `Soft-delete a changelog entry. This cannot be undone via the API.

Examples:
- Delete: delete_changelog({ changelogId: "changelog_01abc..." })`,
    schema: deleteChangelogSchema,
    annotations: DESTRUCTIVE,
    scope: 'write:changelog',
    teamOnly: true,
    handler: async (args) => {
      await deleteChangelog(args.changelogId as ChangelogId)

      return jsonResult({ deleted: true, changelogId: args.changelogId })
    },
  })
}
