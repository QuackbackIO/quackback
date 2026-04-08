# MCP Help Center Tools Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add help center tools, scopes, and resources to the MCP server so agents can search, browse, create, update, and delete help center articles and categories.

**Architecture:** Extend existing `search` and `get_details` tools with help center entity support, add 4 new write tools (`create_article`, `update_article`, `delete_article`, `manage_category`), add 1 resource (`quackback://help-center/categories`), and introduce 2 new OAuth scopes (`read:help-center`, `write:help-center`). Feature-flag all help center operations behind `isFeatureEnabled('helpCenter')`.

**Tech Stack:** MCP SDK (`@modelcontextprotocol/sdk`), Zod schemas, better-auth OAuth provider, existing help center domain services.

**Spec:** `docs/superpowers/specs/2026-04-08-mcp-help-center-tools-design.md`

---

### Task 1: Add new OAuth scopes to type system and handler

**Files:**

- Modify: `apps/web/src/lib/server/mcp/types.ts:4`
- Modify: `apps/web/src/lib/server/mcp/handler.ts:35`

- [ ] **Step 1: Update McpScope type**

In `apps/web/src/lib/server/mcp/types.ts`, change line 4 from:

```typescript
export type McpScope = 'read:feedback' | 'write:feedback' | 'write:changelog'
```

to:

```typescript
export type McpScope =
  | 'read:feedback'
  | 'write:feedback'
  | 'write:changelog'
  | 'read:help-center'
  | 'write:help-center'
```

- [ ] **Step 2: Update ALL_SCOPES in handler**

In `apps/web/src/lib/server/mcp/handler.ts`, change line 35 from:

```typescript
const ALL_SCOPES: McpScope[] = ['read:feedback', 'write:feedback', 'write:changelog']
```

to:

```typescript
const ALL_SCOPES: McpScope[] = [
  'read:feedback',
  'write:feedback',
  'write:changelog',
  'read:help-center',
  'write:help-center',
]
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck 2>&1 | grep -E '(error TS|mcp/)' | head -20`
Expected: No new errors in mcp/ files.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/server/mcp/types.ts apps/web/src/lib/server/mcp/handler.ts
git commit -m "feat(mcp): add read:help-center and write:help-center scopes"
```

---

### Task 2: Add scopes to OAuth provider, protected resource metadata, and consent screen

**Files:**

- Modify: `apps/web/src/lib/server/auth/index.ts:309-328`
- Modify: `apps/web/src/routes/[.]well-known.oauth-protected-resource.ts:26-34`
- Modify: `apps/web/src/routes/oauth/consent.tsx:45-65`

- [ ] **Step 1: Add scopes to OAuth provider config**

In `apps/web/src/lib/server/auth/index.ts`, update the `scopes` array (lines 309-317) to add the two new scopes after `write:changelog`:

```typescript
scopes: [
  'openid',
  'profile',
  'email',
  'offline_access',
  'read:feedback',
  'write:feedback',
  'write:changelog',
  'read:help-center',
  'write:help-center',
],
```

And update `clientRegistrationDefaultScopes` (lines 320-328) similarly:

```typescript
clientRegistrationDefaultScopes: [
  'openid',
  'profile',
  'email',
  'read:feedback',
  'offline_access',
  'write:feedback',
  'write:changelog',
  'read:help-center',
  'write:help-center',
],
```

- [ ] **Step 2: Add scopes to protected resource metadata**

In `apps/web/src/routes/[.]well-known.oauth-protected-resource.ts`, update `scopes_supported` (lines 26-34) to add the new scopes:

```typescript
scopes_supported: [
  'openid',
  'profile',
  'email',
  'offline_access',
  'read:feedback',
  'write:feedback',
  'write:changelog',
  'read:help-center',
  'write:help-center',
],
```

- [ ] **Step 3: Add consent screen labels**

In `apps/web/src/routes/oauth/consent.tsx`, add two entries to `SCOPE_LABELS` (after the `write:changelog` entry at line 60):

```typescript
'read:help-center': {
  label: 'Read help center',
  description: 'Browse categories and articles',
},
'write:help-center': {
  label: 'Write help center',
  description: 'Create, edit, and delete articles and categories',
},
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/server/auth/index.ts apps/web/src/routes/\[.\]well-known.oauth-protected-resource.ts apps/web/src/routes/oauth/consent.tsx
git commit -m "feat(mcp): register help center scopes in OAuth provider and consent screen"
```

---

### Task 3: Extend `search` tool with articles entity

**Files:**

- Modify: `apps/web/src/lib/server/mcp/tools.ts`

This task adds the `'articles'` entity to the search tool and creates the `searchArticles` helper function.

- [ ] **Step 1: Add imports**

At the top of `tools.ts`, add these imports after the existing domain service imports (after line 68):

```typescript
import {
  listArticles,
  getArticleById,
  getCategoryById,
  createArticle,
  updateArticle,
  publishArticle,
  unpublishArticle,
  deleteArticle,
  createCategory,
  updateCategory,
  deleteCategory,
  listCategories,
} from '@/lib/server/domains/help-center/help-center.service'
import { isFeatureEnabled } from '@/lib/server/domains/settings/settings.service'
import type { HelpCenterArticleId, HelpCenterCategoryId } from '@quackback/ids'
```

- [ ] **Step 2: Add feature flag helper**

After the `requireTeamRole` helper (after line 149), add:

```typescript
/** Return an error if the help center feature is disabled. */
async function requireHelpCenter(): Promise<CallToolResult | null> {
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
```

- [ ] **Step 3: Update search schema**

Change the `searchSchema` (line 173-212) `entity` field from:

```typescript
entity: z
  .enum(['posts', 'changelogs'])
  .default('posts')
  .describe('Entity type to search. Defaults to posts.'),
```

to:

```typescript
entity: z
  .enum(['posts', 'changelogs', 'articles'])
  .default('posts')
  .describe('Entity type to search. Defaults to posts.'),
```

Add `categoryId` field to the schema after the `boardId` field:

```typescript
categoryId: z
  .string()
  .optional()
  .describe('Filter articles by category TypeID (ignored for posts and changelogs)'),
```

- [ ] **Step 4: Update SearchArgs type alias**

Change the `SearchArgs` type (line 399-411) to:

```typescript
type SearchArgs = {
  entity: 'posts' | 'changelogs' | 'articles'
  query?: string
  boardId?: string
  categoryId?: string
  status?: string
  tagIds?: string[]
  dateFrom?: string
  dateTo?: string
  showDeleted: boolean
  sort: 'newest' | 'oldest' | 'votes'
  limit: number
  cursor?: string
}
```

- [ ] **Step 5: Update search tool description and handler**

Update the search tool description string (lines 528-535) to:

```typescript
;`Search feedback posts, changelog entries, or help center articles. Returns paginated results with a cursor for fetching more.

Examples:
- Search all posts: search()
- Search by text: search({ query: "dark mode" })
- Filter by board and status: search({ boardId: "board_01abc...", status: "open" })
- Search changelogs: search({ entity: "changelogs", status: "published" })
- Search articles: search({ entity: "articles", query: "getting started" })
- Filter articles by category: search({ entity: "articles", categoryId: "helpcenter_category_01abc..." })
- Sort by votes: search({ sort: "votes", limit: 10 })`
```

Update the search handler (lines 538-554) to branch on entity before scope check:

```typescript
;async (args: SearchArgs): Promise<CallToolResult> => {
  if (args.entity === 'articles') {
    const flagDenied = await requireHelpCenter()
    if (flagDenied) return flagDenied
    const denied = requireScope(auth, 'read:help-center')
    if (denied) return denied
    try {
      return await searchArticles(args)
    } catch (err) {
      return errorResult(err)
    }
  }

  const denied = requireScope(auth, 'read:feedback')
  if (denied) return denied
  // showDeleted requires team role
  if (args.showDeleted) {
    const roleDenied = requireTeamRole(auth)
    if (roleDenied) return roleDenied
  }
  try {
    if (args.entity === 'changelogs') {
      return await searchChangelogs(args)
    }
    return await searchPosts(args)
  } catch (err) {
    return errorResult(err)
  }
}
```

- [ ] **Step 6: Add searchArticles helper**

After the `searchChangelogs` function (after line 1536), add:

```typescript
async function searchArticles(args: SearchArgs): Promise<CallToolResult> {
  const decoded = decodeSearchCursor(args.cursor)
  if (args.cursor && decoded.entity && decoded.entity !== 'articles') {
    return errorResult(
      new Error('Cursor is from a different entity type. Do not reuse cursors across entity types.')
    )
  }
  const cursorValue = typeof decoded.value === 'string' ? decoded.value : undefined

  const validStatuses = new Set(['draft', 'published', 'all'])
  const status = validStatuses.has(args.status ?? '')
    ? (args.status as 'draft' | 'published' | 'all')
    : undefined

  const result = await listArticles({
    categoryId: args.categoryId,
    status,
    search: args.query,
    cursor: cursorValue,
    limit: args.limit,
  })

  const lastItem = result.items[result.items.length - 1]
  const nextCursor = result.hasMore && lastItem ? encodeSearchCursor('articles', lastItem.id) : null

  return compactJsonResult({
    articles: result.items.map((a) => ({
      id: a.id,
      slug: a.slug,
      title: a.title,
      excerpt: a.content
        ? a.content.length > 200
          ? a.content.slice(0, 200) + '...'
          : a.content
        : '',
      description: a.description,
      status: a.publishedAt ? 'published' : 'draft',
      categoryId: a.category.id,
      categoryName: a.category.name,
      categorySlug: a.category.slug,
      authorName: a.author?.name ?? null,
      publishedAt: a.publishedAt,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    })),
    nextCursor,
    hasMore: result.hasMore,
  })
}
```

- [ ] **Step 7: Run typecheck**

Run: `bun run typecheck 2>&1 | grep -E '(error TS|mcp/tools)' | head -20`
Expected: No new errors.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/server/mcp/tools.ts
git commit -m "feat(mcp): extend search tool with articles entity"
```

---

### Task 4: Extend `get_details` tool with help center prefixes

**Files:**

- Modify: `apps/web/src/lib/server/mcp/tools.ts`

- [ ] **Step 1: Update get_details description**

Change the description string (lines 560-564) to:

```typescript
;`Get full details for any entity by TypeID. Entity type is auto-detected from the ID prefix.

Examples:
- Get a post: get_details({ id: "post_01abc..." })
- Get a changelog: get_details({ id: "changelog_01xyz..." })
- Get an article: get_details({ id: "helpcenter_article_01abc..." })
- Get a category: get_details({ id: "helpcenter_category_01abc..." })`
```

- [ ] **Step 2: Update get_details handler**

Replace the handler (lines 567-596) with per-branch scope checking:

```typescript
;async (args: GetDetailsArgs): Promise<CallToolResult> => {
  try {
    let prefix: string
    try {
      prefix = getTypeIdPrefix(args.id)
    } catch {
      return errorResult(
        new Error(
          `Invalid TypeID format: "${args.id}". Expected format: prefix_base32suffix (e.g., post_01abc..., helpcenter_article_01abc...)`
        )
      )
    }

    switch (prefix) {
      case 'post': {
        const denied = requireScope(auth, 'read:feedback')
        if (denied) return denied
        return await getPostDetails(args.id as PostId)
      }
      case 'changelog': {
        const denied = requireScope(auth, 'read:feedback')
        if (denied) return denied
        return await getChangelogDetails(args.id as ChangelogId)
      }
      case 'helpcenter_article': {
        const flagDenied = await requireHelpCenter()
        if (flagDenied) return flagDenied
        const denied = requireScope(auth, 'read:help-center')
        if (denied) return denied
        return await getArticleDetails(args.id as HelpCenterArticleId)
      }
      case 'helpcenter_category': {
        const flagDenied = await requireHelpCenter()
        if (flagDenied) return flagDenied
        const denied = requireScope(auth, 'read:help-center')
        if (denied) return denied
        return await getCategoryDetails(args.id as HelpCenterCategoryId)
      }
      default:
        return errorResult(
          new Error(
            `Unsupported entity type: "${prefix}". Supported: post, changelog, helpcenter_article, helpcenter_category`
          )
        )
    }
  } catch (err) {
    return errorResult(err)
  }
}
```

- [ ] **Step 3: Add getArticleDetails and getCategoryDetails helpers**

After the `getChangelogDetails` function (after line 1608), add:

```typescript
async function getArticleDetails(articleId: HelpCenterArticleId): Promise<CallToolResult> {
  const article = await getArticleById(articleId)

  return jsonResult({
    id: article.id,
    slug: article.slug,
    title: article.title,
    content: article.content,
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

async function getCategoryDetails(categoryId: HelpCenterCategoryId): Promise<CallToolResult> {
  const category = await getCategoryById(categoryId)

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
```

- [ ] **Step 4: Run typecheck**

Run: `bun run typecheck 2>&1 | grep -E '(error TS|mcp/tools)' | head -20`
Expected: No new errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/mcp/tools.ts
git commit -m "feat(mcp): extend get_details with helpcenter_article and helpcenter_category"
```

---

### Task 5: Add `create_article` tool

**Files:**

- Modify: `apps/web/src/lib/server/mcp/tools.ts`

- [ ] **Step 1: Add schema and type alias**

Add to the schemas section (after `getPostActivitySchema` around line 391):

```typescript
const createHelpCenterArticleSchema = {
  categoryId: z
    .string()
    .describe('Category TypeID (use quackback://help-center/categories resource to find IDs)'),
  title: z.string().max(200).describe('Article title (max 200 characters)'),
  content: z.string().max(50000).describe('Article content (markdown, max 50,000 characters)'),
  slug: z.string().max(200).optional().describe('URL slug (auto-generated from title if omitted)'),
}
```

Add to the type aliases section (after `GetPostActivityArgs`):

```typescript
type CreateHelpCenterArticleArgs = {
  categoryId: string
  title: string
  content: string
  slug?: string
}
```

- [ ] **Step 2: Register the tool**

Inside `registerTools`, after the `get_post_activity` tool registration (before the closing `}` of `registerTools` at line 1419), add:

```typescript
// create_article
server.tool(
  'create_article',
  `Create a new help center article (draft). Use update_article to publish it.

Examples:
- create_article({ categoryId: "helpcenter_category_01abc...", title: "Getting Started", content: "Welcome to..." })
- With custom slug: create_article({ categoryId: "helpcenter_category_01abc...", title: "FAQ", content: "...", slug: "frequently-asked-questions" })`,
  createHelpCenterArticleSchema,
  WRITE,
  async (args: CreateHelpCenterArticleArgs): Promise<CallToolResult> => {
    const flagDenied = await requireHelpCenter()
    if (flagDenied) return flagDenied
    const scopeDenied = requireScope(auth, 'write:help-center')
    if (scopeDenied) return scopeDenied
    const roleDenied = requireTeamRole(auth)
    if (roleDenied) return roleDenied
    try {
      const article = await createArticle(
        {
          categoryId: args.categoryId,
          title: args.title,
          content: args.content,
          slug: args.slug,
        },
        auth.principalId
      )

      return jsonResult({
        id: article.id,
        slug: article.slug,
        title: article.title,
        content: article.content,
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
    } catch (err) {
      return errorResult(err)
    }
  }
)
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck 2>&1 | grep -E '(error TS|mcp/tools)' | head -20`
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/server/mcp/tools.ts
git commit -m "feat(mcp): add create_article tool"
```

---

### Task 6: Add `update_article` tool

**Files:**

- Modify: `apps/web/src/lib/server/mcp/tools.ts`

- [ ] **Step 1: Add schema and type alias**

Add to schemas section:

```typescript
const updateHelpCenterArticleSchema = {
  articleId: z.string().describe('Article TypeID to update'),
  title: z.string().max(200).optional().describe('New title'),
  content: z
    .string()
    .max(50000)
    .optional()
    .describe('New content (markdown, max 50,000 characters)'),
  slug: z.string().max(200).optional().describe('New URL slug'),
  categoryId: z.string().optional().describe('Move to a different category TypeID'),
  publishedAt: z
    .string()
    .datetime()
    .nullable()
    .optional()
    .describe('ISO 8601 datetime to publish (e.g. "2026-04-08T00:00:00Z"), or null to unpublish'),
}
```

Add to type aliases:

```typescript
type UpdateHelpCenterArticleArgs = {
  articleId: string
  title?: string
  content?: string
  slug?: string
  categoryId?: string
  publishedAt?: string | null
}
```

- [ ] **Step 2: Register the tool**

After `create_article` tool, add:

```typescript
// update_article
server.tool(
  'update_article',
  `Update a help center article. All fields optional — only provided fields change. Set publishedAt to an ISO datetime to publish, or null to unpublish.

Examples:
- Update title: update_article({ articleId: "helpcenter_article_01abc...", title: "New Title" })
- Publish: update_article({ articleId: "helpcenter_article_01abc...", publishedAt: "2026-04-08T00:00:00Z" })
- Unpublish: update_article({ articleId: "helpcenter_article_01abc...", publishedAt: null })`,
  updateHelpCenterArticleSchema,
  WRITE,
  async (args: UpdateHelpCenterArticleArgs): Promise<CallToolResult> => {
    const flagDenied = await requireHelpCenter()
    if (flagDenied) return flagDenied
    const scopeDenied = requireScope(auth, 'write:help-center')
    if (scopeDenied) return scopeDenied
    const roleDenied = requireTeamRole(auth)
    if (roleDenied) return roleDenied
    try {
      // Handle publish/unpublish via publishedAt
      if (args.publishedAt !== undefined) {
        if (args.publishedAt === null) {
          await unpublishArticle(args.articleId as HelpCenterArticleId)
        } else {
          await publishArticle(args.articleId as HelpCenterArticleId)
        }
      }

      const { articleId: _, publishedAt: __, ...updateData } = args
      const hasUpdates = Object.values(updateData).some((v) => v !== undefined)

      let article
      if (hasUpdates) {
        article = await updateArticle(args.articleId as HelpCenterArticleId, updateData)
      } else {
        article = await getArticleById(args.articleId as HelpCenterArticleId)
      }

      return jsonResult({
        id: article.id,
        slug: article.slug,
        title: article.title,
        content: article.content,
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
    } catch (err) {
      return errorResult(err)
    }
  }
)
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck 2>&1 | grep -E '(error TS|mcp/tools)' | head -20`
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/server/mcp/tools.ts
git commit -m "feat(mcp): add update_article tool"
```

---

### Task 7: Add `delete_article` tool

**Files:**

- Modify: `apps/web/src/lib/server/mcp/tools.ts`

- [ ] **Step 1: Add schema and type alias**

```typescript
const deleteHelpCenterArticleSchema = {
  articleId: z.string().describe('Article TypeID to delete'),
}
```

```typescript
type DeleteHelpCenterArticleArgs = { articleId: string }
```

- [ ] **Step 2: Register the tool**

After `update_article` tool, add:

```typescript
// delete_article
server.tool(
  'delete_article',
  `Soft-delete a help center article.

Example:
- delete_article({ articleId: "helpcenter_article_01abc..." })`,
  deleteHelpCenterArticleSchema,
  DESTRUCTIVE,
  async (args: DeleteHelpCenterArticleArgs): Promise<CallToolResult> => {
    const flagDenied = await requireHelpCenter()
    if (flagDenied) return flagDenied
    const scopeDenied = requireScope(auth, 'write:help-center')
    if (scopeDenied) return scopeDenied
    const roleDenied = requireTeamRole(auth)
    if (roleDenied) return roleDenied
    try {
      await deleteArticle(args.articleId as HelpCenterArticleId)
      return jsonResult({ deleted: true, id: args.articleId })
    } catch (err) {
      return errorResult(err)
    }
  }
)
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck 2>&1 | grep -E '(error TS|mcp/tools)' | head -20`
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/server/mcp/tools.ts
git commit -m "feat(mcp): add delete_article tool"
```

---

### Task 8: Add `manage_category` tool

**Files:**

- Modify: `apps/web/src/lib/server/mcp/tools.ts`

- [ ] **Step 1: Add schema and type alias**

```typescript
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
```

```typescript
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
```

- [ ] **Step 2: Register the tool**

After `delete_article` tool, add:

```typescript
// manage_category
server.tool(
  'manage_category',
  `Create, update, or delete a help center category.

Examples:
- Create: manage_category({ action: "create", name: "Getting Started", icon: "🚀" })
- Update: manage_category({ action: "update", categoryId: "helpcenter_category_01abc...", name: "New Name" })
- Delete: manage_category({ action: "delete", categoryId: "helpcenter_category_01abc..." })`,
  manageCategorySchema,
  DESTRUCTIVE,
  async (args: ManageCategoryArgs): Promise<CallToolResult> => {
    const flagDenied = await requireHelpCenter()
    if (flagDenied) return flagDenied
    const scopeDenied = requireScope(auth, 'write:help-center')
    if (scopeDenied) return scopeDenied
    const roleDenied = requireTeamRole(auth)
    if (roleDenied) return roleDenied
    try {
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
        case 'update': {
          if (!args.categoryId) {
            return errorResult(new Error('categoryId is required when action is "update"'))
          }
          const { action: _, categoryId: __, ...updateData } = args
          const category = await updateCategory(args.categoryId as HelpCenterCategoryId, updateData)
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
        case 'delete': {
          if (!args.categoryId) {
            return errorResult(new Error('categoryId is required when action is "delete"'))
          }
          await deleteCategory(args.categoryId as HelpCenterCategoryId)
          return jsonResult({ deleted: true, id: args.categoryId })
        }
      }
    } catch (err) {
      return errorResult(err)
    }
  }
)
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck 2>&1 | grep -E '(error TS|mcp/tools)' | head -20`
Expected: No new errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/server/mcp/tools.ts
git commit -m "feat(mcp): add manage_category tool"
```

---

### Task 9: Add help-center/categories resource and refactor scopeGated

**Files:**

- Modify: `apps/web/src/lib/server/mcp/server.ts`

- [ ] **Step 1: Refactor scopeGated to accept scope parameter**

In `server.ts`, change the `scopeGated` function (lines 24-39) from:

```typescript
function scopeGated(auth: McpAuthContext, fn: ReadResourceCallback): ReadResourceCallback {
  return async (uri, extra) => {
    if (!auth.scopes.includes('read:feedback')) {
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'text/plain',
            text: 'Error: Insufficient scope. Required: read:feedback',
          },
        ],
      }
    }
    return fn(uri, extra)
  }
}
```

to:

```typescript
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
```

Add `McpScope` to the import from `./types`:

```typescript
import type { McpAuthContext, McpScope } from './types'
```

- [ ] **Step 2: Update existing resource calls**

Update all 5 existing `scopeGated` calls to pass `'read:feedback'` as the scope parameter. Change each from:

```typescript
scopeGated(auth, async () => {
```

to:

```typescript
scopeGated(auth, 'read:feedback', async () => {
```

- [ ] **Step 3: Add help-center/categories resource**

After the `members` resource (after line 124), add:

```typescript
server.resource(
  'help-center-categories',
  'quackback://help-center/categories',
  { description: 'List all help center categories with article counts' },
  scopeGated(auth, 'read:help-center', async () => {
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
    const { listCategories } = await import('@/lib/server/domains/help-center/help-center.service')
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
```

- [ ] **Step 4: Run typecheck**

Run: `bun run typecheck 2>&1 | grep -E '(error TS|mcp/server)' | head -20`
Expected: No new errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/server/mcp/server.ts
git commit -m "feat(mcp): add help-center/categories resource, refactor scopeGated"
```

---

### Task 10: Update tools.ts JSDoc header

**Files:**

- Modify: `apps/web/src/lib/server/mcp/tools.ts:1-28`

- [ ] **Step 1: Update the header comment**

Replace lines 1-28 with:

```typescript
/**
 * MCP Tools for Quackback
 *
 * 27 tools calling domain services directly (no HTTP self-loop):
 * - search: Unified search across posts, changelogs, and articles
 * - get_details: Get full details for any entity by TypeID
 * - triage_post: Update post status, tags, and owner
 * - vote_post: Toggle vote on a post
 * - proxy_vote: Add or remove a vote on behalf of another user
 * - add_comment: Post a comment on a post
 * - create_post: Submit new feedback
 * - delete_post: Soft-delete a post
 * - restore_post: Restore a soft-deleted post
 * - create_changelog: Create a changelog entry
 * - update_changelog: Update title, content, publish state, linked posts
 * - delete_changelog: Soft-delete a changelog entry
 * - update_comment: Edit a comment's content
 * - delete_comment: Hard-delete a comment and its replies
 * - react_to_comment: Add or remove emoji reaction on a comment
 * - manage_roadmap_post: Add or remove a post from a roadmap
 * - merge_post: Merge a duplicate post into a canonical post
 * - unmerge_post: Restore a merged post to independent state
 * - list_suggestions: List AI-generated feedback suggestions
 * - accept_suggestion: Accept a feedback or merge suggestion
 * - dismiss_suggestion: Dismiss a suggestion
 * - restore_suggestion: Restore a dismissed suggestion to pending
 * - get_post_activity: Get activity log for a post
 * - create_article: Create a help center article (draft)
 * - update_article: Update or publish/unpublish an article
 * - delete_article: Soft-delete an article
 * - manage_category: Create, update, or delete a help center category
 */
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/lib/server/mcp/tools.ts
git commit -m "docs(mcp): update tools.ts header to list all 27 tools"
```
