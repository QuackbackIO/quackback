/**
 * Help center tools: article CRUD + category management. All writes require
 * the helpCenter feature flag, the write:article scope, and a team role,
 * declared as `feature` + `scope` + `teamOnly` metadata on registerTool.
 */

import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import {
  getArticleById,
  createArticle,
  updateArticle,
  publishArticle,
  unpublishArticle,
  deleteArticle,
  createCategory,
  updateCategory,
  deleteCategory,
} from '@/lib/server/domains/help-center/help-center.service'
import { parseOptionalTypeId } from '@/lib/server/domains/api/validation'
import type { PrincipalId, KbArticleId, KbCategoryId } from '@quackback/ids'
import type { McpAuthContext } from '../types'
import {
  registerTool,
  jsonResult,
  errorResult,
  articleResult,
  categoryResult,
  WRITE,
  DESTRUCTIVE,
  CONTENT_FORMAT_BLOCK,
  CONTENT_FIELD_DESCRIBE,
} from './helpers'

// ============================================================================
// Schemas
// ============================================================================

const createHelpCenterArticleSchema = {
  categoryId: z
    .string()
    .describe('Category TypeID (use quackback://help-center/categories resource to find IDs)'),
  title: z.string().max(200).describe('Article title (max 200 characters)'),
  content: z
    .string()
    .max(50000)
    .describe(`Article content (max 50,000 characters). ${CONTENT_FIELD_DESCRIBE}`),
  slug: z.string().max(200).optional().describe('URL slug (auto-generated from title if omitted)'),
  description: z
    .string()
    .max(300)
    .optional()
    .describe('Short page description for SEO and article previews (max 300 chars)'),
  authorId: z
    .string()
    .optional()
    .describe('Principal TypeID of the article author (defaults to the authenticated caller)'),
}

const updateHelpCenterArticleSchema = {
  articleId: z.string().describe('Article TypeID to update'),
  title: z.string().max(200).optional().describe('New title'),
  content: z
    .string()
    .max(50000)
    .optional()
    .describe(`New content (max 50,000 characters). ${CONTENT_FIELD_DESCRIBE}`),
  slug: z.string().max(200).optional().describe('New URL slug'),
  description: z.string().max(300).optional().describe('New page description (max 300 chars)'),
  categoryId: z.string().optional().describe('Move to a different category TypeID'),
  publishedAt: z
    .string()
    .datetime()
    .nullable()
    .optional()
    .describe(
      'Any ISO 8601 datetime string to publish immediately (e.g. "2026-04-08T00:00:00Z"), or null to unpublish. The exact timestamp is not used — articles are always published at the current time.'
    ),
  authorId: z.string().optional().describe('Principal TypeID to reassign as the article author'),
}

const deleteHelpCenterArticleSchema = {
  articleId: z.string().describe('Article TypeID to delete'),
}

const manageCategorySchema = {
  action: z.enum(['create', 'update', 'delete']).describe('Operation to perform'),
  categoryId: z.string().optional().describe('Category TypeID (required for update and delete)'),
  name: z.string().max(200).optional().describe('Category name (required for create)'),
  slug: z.string().max(200).optional().describe('URL slug'),
  description: z.string().max(2000).nullable().optional().describe('Category description'),
  icon: z.string().max(50).nullable().optional().describe('Emoji icon (e.g. "🚀")'),
  parentId: z
    .string()
    .nullable()
    .optional()
    .describe('Parent category TypeID, or null for top-level'),
  isPublic: z.boolean().optional().describe('Whether category is publicly visible'),
}

// ============================================================================
// Type aliases — manually defined to avoid deep Zod type recursion.
// WARNING: These must stay in sync with the Zod schemas above.
// If you add/remove/rename a field in a schema, update the matching type here.
// ============================================================================

type CreateHelpCenterArticleArgs = {
  categoryId: string
  title: string
  content: string
  slug?: string
  description?: string
  authorId?: string
}

type UpdateHelpCenterArticleArgs = {
  articleId: string
  title?: string
  content?: string
  slug?: string
  description?: string
  categoryId?: string
  publishedAt?: string | null
  authorId?: string
}

type DeleteHelpCenterArticleArgs = { articleId: string }

type ManageCategoryArgs = {
  action: 'create' | 'update' | 'delete'
  categoryId?: string
  name?: string
  slug?: string
  description?: string | null
  icon?: string | null
  parentId?: string | null
  isPublic?: boolean
}

// ============================================================================
// Tool registration
// ============================================================================

export function registerHelpCenterTools(server: McpServer, auth: McpAuthContext) {
  registerTool<CreateHelpCenterArticleArgs>(server, auth, {
    name: 'create_article',
    description: `Create a new help center article (draft). Use update_article to publish it.

Examples:
- create_article({ categoryId: "kb_category_01abc...", title: "Getting Started", content: "Welcome to..." })
- With custom slug: create_article({ categoryId: "kb_category_01abc...", title: "FAQ", content: "...", slug: "frequently-asked-questions" })${CONTENT_FORMAT_BLOCK}`,
    schema: createHelpCenterArticleSchema,
    annotations: WRITE,
    feature: 'helpCenter',
    scope: 'write:article',
    teamOnly: true,
    handler: async (args) => {
      const authorPrincipalId = parseOptionalTypeId<PrincipalId>(
        args.authorId,
        'principal',
        'author ID'
      )
      const article = await createArticle(
        {
          categoryId: args.categoryId,
          title: args.title,
          content: args.content,
          slug: args.slug,
          description: args.description,
        },
        auth.principalId,
        authorPrincipalId
      )

      return articleResult(article)
    },
  })

  registerTool<UpdateHelpCenterArticleArgs>(server, auth, {
    name: 'update_article',
    description: `Update a help center article. All fields optional — only provided fields change. Set publishedAt to any ISO datetime string to publish immediately, or null to unpublish.

Examples:
- Update title: update_article({ articleId: "kb_article_01abc...", title: "New Title" })
- Publish: update_article({ articleId: "kb_article_01abc...", publishedAt: "2026-04-08T00:00:00Z" })
- Unpublish: update_article({ articleId: "kb_article_01abc...", publishedAt: null })${CONTENT_FORMAT_BLOCK}`,
    schema: updateHelpCenterArticleSchema,
    annotations: WRITE,
    feature: 'helpCenter',
    scope: 'write:article',
    teamOnly: true,
    handler: async (args) => {
      const authorPrincipalId = parseOptionalTypeId<PrincipalId>(
        args.authorId,
        'principal',
        'author ID'
      )

      const { articleId: _, publishedAt: __, authorId: ___, ...updateData } = args
      const hasUpdates =
        Object.values(updateData).some((v) => v !== undefined) || authorPrincipalId !== undefined

      // Validate + apply field/author updates first so a bad authorId
      // never leaves the article in a partially-published state.
      let article = null
      if (hasUpdates) {
        article = await updateArticle(args.articleId as KbArticleId, updateData, authorPrincipalId)
      }

      if (args.publishedAt !== undefined) {
        article =
          args.publishedAt === null
            ? await unpublishArticle(args.articleId as KbArticleId)
            : await publishArticle(args.articleId as KbArticleId)
      }

      if (!article) {
        article = await getArticleById(args.articleId as KbArticleId)
      }

      return articleResult(article)
    },
  })

  registerTool<DeleteHelpCenterArticleArgs>(server, auth, {
    name: 'delete_article',
    description: `Soft-delete a help center article.

Example:
- delete_article({ articleId: "kb_article_01abc..." })`,
    schema: deleteHelpCenterArticleSchema,
    annotations: DESTRUCTIVE,
    feature: 'helpCenter',
    scope: 'write:article',
    teamOnly: true,
    handler: async (args) => {
      await deleteArticle(args.articleId as KbArticleId)
      return jsonResult({ deleted: true, id: args.articleId })
    },
  })

  registerTool<ManageCategoryArgs>(server, auth, {
    name: 'manage_category',
    description: `Create, update, or delete a help center category.

Examples:
- Create: manage_category({ action: "create", name: "Getting Started", icon: "🚀" })
- Update: manage_category({ action: "update", categoryId: "kb_category_01abc...", name: "New Name" })
- Delete: manage_category({ action: "delete", categoryId: "kb_category_01abc..." })`,
    schema: manageCategorySchema,
    annotations: DESTRUCTIVE,
    feature: 'helpCenter',
    scope: 'write:article',
    teamOnly: true,
    handler: async (args) => {
      switch (args.action) {
        case 'create': {
          if (!args.name) {
            return errorResult(new Error('name is required when action is "create"'))
          }
          const category = await createCategory({
            name: args.name,
            slug: args.slug,
            description: args.description ?? undefined,
            icon: args.icon ?? undefined,
            parentId: args.parentId ?? undefined,
            isPublic: args.isPublic,
          })
          return categoryResult(category)
        }
        case 'update': {
          if (!args.categoryId) {
            return errorResult(new Error('categoryId is required when action is "update"'))
          }
          const { action: _, categoryId: __, ...updateData } = args
          const category = await updateCategory(args.categoryId as KbCategoryId, updateData)
          return categoryResult(category)
        }
        case 'delete': {
          if (!args.categoryId) {
            return errorResult(new Error('categoryId is required when action is "delete"'))
          }
          await deleteCategory(args.categoryId as KbCategoryId)
          return jsonResult({ deleted: true, id: args.categoryId })
        }
      }
    },
  })
}
