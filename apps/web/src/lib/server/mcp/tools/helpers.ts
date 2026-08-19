/**
 * Shared plumbing for the MCP tool modules: result wrappers, cursor codecs,
 * authorization guards, annotations, and the `registerTool` helper that owns
 * guard placement so individual tools declare `{ scope, teamOnly, feature }`
 * metadata instead of hand-copying guard calls.
 */

import { z } from 'zod'
import type { McpServer, ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { CallToolResult, ToolAnnotations } from '@modelcontextprotocol/sdk/types.js'
import type { SegmentId } from '@quackback/ids'
import { isTeamMember } from '@/lib/shared/roles'
import { isFeatureEnabled } from '@/lib/server/domains/settings/settings.service'
import { segmentIdsForPrincipal } from '@/lib/server/domains/segments/segment-membership.service'
import { DomainException } from '@/lib/shared/errors'
import { contentJsonToMarkdown } from '@/lib/server/markdown-tiptap'
import type { TiptapContent } from '@/lib/server/db'
import type { Actor } from '@/lib/server/policy/types'
import type { McpAuthContext, McpScope } from '../types'

// ============================================================================
// Result wrappers
// ============================================================================

/** Wrap a data object as a successful MCP tool result (pretty-printed, for single-entity responses). */
export function jsonResult(data: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  }
}

/** Wrap a data object as a compact MCP tool result (no pretty-print, for list responses). */
export function compactJsonResult(data: unknown): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data) }],
  }
}

/** Convert a domain error to an MCP tool error result. */
export function errorResult(err: unknown): CallToolResult {
  let message: string
  if (err instanceof DomainException) {
    message = `${err.message} (code: ${err.code})`
  } else if (err instanceof Error) {
    message = err.message
  } else {
    message = 'Unknown error'
  }
  return {
    isError: true,
    content: [{ type: 'text', text: `Error: ${message}` }],
  }
}

// ============================================================================
// Cursor codecs
// ============================================================================

/** Encode a search cursor with entity type to prevent cross-entity misuse. */
export function encodeSearchCursor(entity: string, value: number | string): string {
  return Buffer.from(JSON.stringify({ entity, value })).toString('base64url')
}

/** Decode a search cursor. Returns entity and value, or defaults. */
export function decodeSearchCursor(cursor?: string): { entity: string; value: number | string } {
  if (!cursor) return { entity: '', value: 0 }
  try {
    const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf-8'))
    return { entity: decoded.entity ?? '', value: decoded.value ?? 0 }
  } catch {
    return { entity: '', value: 0 }
  }
}

// ============================================================================
// Authorization guards
// ============================================================================

/** Return an error if the token is missing a required scope. */
export function requireScope(auth: McpAuthContext, scope: McpScope): CallToolResult | null {
  if (auth.scopes.includes(scope)) return null
  return {
    isError: true,
    content: [{ type: 'text', text: `Error: Insufficient scope. Required: ${scope}` }],
  }
}

/** Return an error if the user doesn't have an admin or member role. */
export function requireTeamRole(auth: McpAuthContext): CallToolResult | null {
  if (isTeamMember(auth.role)) return null
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: 'Error: This operation requires a team member (admin or member) role.',
      },
    ],
  }
}

/** Return an error if the help center feature is disabled. */
export async function requireHelpCenter(): Promise<CallToolResult | null> {
  if (await isFeatureEnabled('helpCenter')) return null
  return {
    isError: true,
    content: [
      {
        type: 'text',
        text: 'Error: Help center is not enabled. Enable it in Settings > Features.',
      },
    ],
  }
}

// ============================================================================
// Tool registration
// ============================================================================

/** Feature flags a tool can require before its scope/role guards run. */
type ToolFeature = 'helpCenter'

export interface ToolDef<TArgs> {
  name: string
  description: string
  schema: z.ZodRawShape
  annotations: ToolAnnotations
  /**
   * Scope every invocation must hold. Omit ONLY for tools that dispatch on
   * their arguments and gate per-branch in the handler (search, get_details).
   */
  scope?: McpScope
  /** Additionally require an admin/member (team) role. */
  teamOnly?: boolean
  /** Feature flag that must be enabled, checked before the scope/role guards. */
  feature?: ToolFeature
  handler: (args: TArgs) => Promise<CallToolResult>
}

/**
 * Register a tool with its authorization contract applied declaratively.
 * Guard order is feature flag, then scope, then team role — the same order the
 * hand-written guards used, so denial messages are unchanged.
 *
 * Error ownership also lives here: any error the handler throws becomes the
 * standard errorResult, so handlers only add try/catch when a branch needs a
 * more specific mapping (e.g. get_details' invalid-TypeID message).
 */
export function registerTool<TArgs>(
  server: McpServer,
  auth: McpAuthContext,
  def: ToolDef<TArgs>
): void {
  const wrapped = (async (args: TArgs): Promise<CallToolResult> => {
    if (def.feature) {
      // Single-value ToolFeature union today; every flagged tool is helpCenter.
      const denied = await requireHelpCenter()
      if (denied) return denied
    }
    if (def.scope) {
      const denied = requireScope(auth, def.scope)
      if (denied) return denied
    }
    if (def.teamOnly) {
      const denied = requireTeamRole(auth)
      if (denied) return denied
    }
    try {
      return await def.handler(args)
    } catch (err) {
      return errorResult(err)
    }
  }) as unknown as ToolCallback<z.ZodRawShape>

  server.tool(def.name, def.description, def.schema, def.annotations, wrapped)
}

// ============================================================================
// Shared formatters
// ============================================================================

/** Build the agent-author object used by the conversation write tools (reply, suggest, share). */
export function agentFromMcpAuth(auth: McpAuthContext) {
  return { principalId: auth.principalId, displayName: auth.name, email: auth.email }
}

// ============================================================================
// Policy actors
// ============================================================================

/** MCP callers are human (OAuth / legacy human-backed keys) or service principals. */
export function principalTypeOf(auth: McpAuthContext): 'user' | 'service' {
  return auth.userId ? 'user' : 'service'
}

/**
 * Policy actor for the agent-side conversation tools. The conversation gates
 * (canViewConversation / canActAsAgent) short-circuit on the team role, so
 * segment memberships are never consulted and stay empty.
 */
export function mcpAgentActor(auth: McpAuthContext): Actor {
  return {
    principalId: auth.principalId,
    role: auth.role,
    principalType: principalTypeOf(auth),
    segmentIds: new Set<SegmentId>(),
  }
}

/**
 * Policy actor carrying the caller's REAL role and resolved segment
 * memberships, for gates that apply board tiers / moderation to the writer
 * (create_post, comment tools). Team roles keep their legitimate bypass;
 * portal users are gated exactly as the portal paths gate them.
 */
export async function mcpMemberActor(auth: McpAuthContext): Promise<Actor> {
  return {
    principalId: auth.principalId,
    role: auth.role,
    principalType: principalTypeOf(auth),
    segmentIds: await segmentIdsForPrincipal(auth.principalId),
  }
}

/** Format a help center article as a tool result. */
export function articleResult(article: {
  id: string
  slug: string
  title: string
  content: string
  contentJson: TiptapContent | null
  description: string | null
  position: number | null
  category: { id: string; slug: string; name: string }
  author: { id: string; name: string; avatarUrl: string | null } | null
  publishedAt: Date | null
  viewCount: number
  helpfulCount: number
  notHelpfulCount: number
  createdAt: Date
  updatedAt: Date
}): CallToolResult {
  return jsonResult({
    id: article.id,
    slug: article.slug,
    title: article.title,
    content: contentJsonToMarkdown(article.contentJson, article.content),
    description: article.description,
    position: article.position,
    category: article.category,
    author: article.author,
    publishedAt: article.publishedAt,
    viewCount: article.viewCount,
    helpfulCount: article.helpfulCount,
    notHelpfulCount: article.notHelpfulCount,
    createdAt: article.createdAt,
    updatedAt: article.updatedAt,
  })
}

/** Format a help center category as a tool result. */
export function categoryResult(category: {
  id: string
  slug: string
  name: string
  description: string | null
  icon: string | null
  parentId: string | null
  isPublic: boolean
  position: number
  createdAt: Date
  updatedAt: Date
}): CallToolResult {
  return jsonResult({
    id: category.id,
    slug: category.slug,
    name: category.name,
    description: category.description,
    icon: category.icon,
    parentId: category.parentId,
    isPublic: category.isPublic,
    position: category.position,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  })
}

// ============================================================================
// Annotations
// ============================================================================

export const READ_ONLY: ToolAnnotations = { readOnlyHint: true, openWorldHint: false }
export const WRITE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
}
export const DESTRUCTIVE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: false,
}

// ============================================================================
// Shared description blocks
// ============================================================================

/**
 * Shared "Content format" block appended to rich-content tool descriptions.
 * Kept as a single constant so the auto-rehost behavior stays DRY across
 * create_post / create_changelog / update_changelog / create_article / update_article.
 */
export const CONTENT_FORMAT_BLOCK = `

Content format: GitHub-flavored Markdown (GFM).
Supported: headings (#, ##, ###), bold/italic/strikethrough, links, ordered/bulleted lists, task lists (- [ ]), inline and fenced code blocks with language hints, blockquotes, tables, horizontal rules, images.
Images: \`![alt](https://...)\`. External URLs are fetched server-side and re-uploaded to workspace storage on save (auto-rehost). Supported image types: PNG, JPEG, WebP, GIF, AVIF. Max 10 MB per image, max 20 images per save. Images exceeding these limits keep their original URL as a fallback.
Example: "## New feature\\n\\nAdds **dark mode**. See screenshot:\\n\\n![dark mode](https://example.com/dark.png)"`

/**
 * Shared tail for rich-content field `.describe()` blurbs. Each schema
 * prepends its own lead ("Post content (max 10,000 characters).", ...) so the
 * format/rehost wording stays identical across posts, changelog, and
 * help-center tools.
 */
export const CONTENT_FIELD_DESCRIBE =
  'Markdown (GFM). Images via ![alt](url) are auto-rehosted to workspace storage on save. See tool description for full format details.'
