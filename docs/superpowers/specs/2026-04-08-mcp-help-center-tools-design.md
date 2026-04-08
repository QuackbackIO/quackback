# MCP Help Center Tools Design

**Date:** 2026-04-08
**Status:** Draft
**Scope:** Add help center (knowledge base) tools, resources, and scopes to the existing MCP server.

## Context

The MCP server has 23 tools covering feedback, changelog, and suggestions. The help center feature (categories + articles) has a full REST API at `/api/v1/help-center/` but zero MCP coverage. Agents using the MCP server cannot browse, search, or manage help center content.

The help center is behind a `helpCenter` feature flag (default off). All MCP tools must respect this.

## Approach

Extend existing tools where natural (`search`, `get_details`), add new tools for write operations, add one resource. Follow Approach A from brainstorming: minimal tool count increase, consistent agent UX.

**Result:** 27 tools (+4), 6 resources (+1), 5 scopes (+2).

---

## 1. New OAuth Scopes

Two new scopes: `read:help-center` and `write:help-center`.

### Files to update

| File                                        | Change                                                                       |
| ------------------------------------------- | ---------------------------------------------------------------------------- |
| `mcp/types.ts`                              | Add to `McpScope` union type                                                 |
| `mcp/handler.ts`                            | Add to `ALL_SCOPES` array                                                    |
| `auth/index.ts`                             | Add to `oauthProvider` `scopes` and `clientRegistrationDefaultScopes` arrays |
| `[.]well-known.oauth-protected-resource.ts` | Add to `scopes_supported` array                                              |
| `oauth/consent.tsx`                         | Add `SCOPE_LABELS` entries                                                   |

### Consent screen labels

| Scope               | Label             | Description                                      |
| ------------------- | ----------------- | ------------------------------------------------ |
| `read:help-center`  | Read help center  | Browse categories and articles                   |
| `write:help-center` | Write help center | Create, edit, and delete articles and categories |

### Backwards compatibility

Existing OAuth tokens will not have the new scopes. Users must re-authorize to get help center access. API keys are unaffected (they receive `ALL_SCOPES` automatically). This is correct least-privilege behavior.

---

## 2. Feature Flag Gating

Every help center tool and resource checks `isFeatureEnabled('helpCenter')` before executing. If disabled, return an actionable error:

```typescript
const HELP_CENTER_DISABLED_ERROR: CallToolResult = {
  isError: true,
  content: [
    {
      type: 'text',
      text: 'Error: Help center is not enabled. Enable it in Settings > Features.',
    },
  ],
}
```

This is new for `tools.ts` — existing tools don't check feature flags because feedback/changelog are always-on. Import `isFeatureEnabled` from the settings service.

The feature flag check runs before the scope check (no point checking scopes for a disabled feature).

---

## 3. Extend `search` Tool

Add `'articles'` to the `entity` enum. Default remains `'posts'`.

### Schema changes

- `entity` enum: `'posts' | 'changelogs'` becomes `'posts' | 'changelogs' | 'articles'`
- New optional field: `categoryId: z.string().optional()` — filter articles by category TypeID (ignored for posts/changelogs)

### Filters by entity

| Filter              | posts               | changelogs                    | articles            |
| ------------------- | ------------------- | ----------------------------- | ------------------- |
| `query`             | text search         | —                             | text search         |
| `status`            | status slug         | draft/published/scheduled/all | draft/published/all |
| `boardId`           | yes                 | ignored                       | ignored             |
| `tagIds`            | yes                 | ignored                       | ignored             |
| `sort`              | newest/oldest/votes | newest                        | newest              |
| `showDeleted`       | yes                 | ignored                       | ignored             |
| `dateFrom`/`dateTo` | yes                 | ignored                       | ignored             |
| `categoryId`        | ignored             | ignored                       | yes                 |

### Scope

Articles search requires `read:help-center` (not `read:feedback`). The scope check moves inside the entity branch rather than being a single gate at the top:

```
if entity is 'articles':
  check helpCenter feature flag
  check read:help-center scope
else:
  check read:feedback scope (existing behavior)
```

### New `searchArticles` helper

Follows the exact pattern of `searchPosts`/`searchChangelogs`:

1. Decode cursor, validate entity is `'articles'`
2. Call `listArticles({ categoryId, status, search: query, cursor, limit })`
3. Encode next cursor with `entity: 'articles'`
4. Return compact JSON

### Article result shape

```typescript
{
  articles: [{
    id: string,
    slug: string,
    title: string,
    excerpt: string,          // first 200 chars of content
    description: string | null,
    status: 'published' | 'draft',
    categoryId: string,
    categoryName: string,
    categorySlug: string,
    authorName: string | null,
    publishedAt: string | null,
    createdAt: string,
    updatedAt: string,
  }],
  nextCursor: string | null,
  hasMore: boolean,
}
```

### Type alias update

```typescript
type SearchArgs = {
  entity: 'posts' | 'changelogs' | 'articles' // added 'articles'
  query?: string
  boardId?: string
  categoryId?: string // new
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

---

## 4. Extend `get_details` Tool

Add `helpcenter_article` and `helpcenter_category` to the prefix switch.

### Scope change

The scope check moves from a single `read:feedback` gate at the top to per-branch checks:

```
switch (prefix):
  case 'post':
  case 'changelog':
    check read:feedback (existing)
  case 'helpcenter_article':
  case 'helpcenter_category':
    check helpCenter feature flag
    check read:help-center
  default:
    error — update supported list
```

### `helpcenter_article` result

Calls `getArticleById()` + `resolveArticleWithCategory()` (via the service). Returns full content (not excerpted — this is the detail view):

```typescript
{
  id: string,
  slug: string,
  title: string,
  content: string,
  description: string | null,
  position: number | null,
  category: { id: string, slug: string, name: string },
  author: { id: string, name: string, avatarUrl: string | null } | null,
  publishedAt: string | null,
  viewCount: number,
  helpfulCount: number,
  notHelpfulCount: number,
  createdAt: string,
  updatedAt: string,
}
```

### `helpcenter_category` result

Calls `getCategoryById()`. Returns:

```typescript
{
  id: string,
  slug: string,
  name: string,
  description: string | null,
  icon: string | null,
  parentId: string | null,
  isPublic: boolean,
  position: number,
  createdAt: string,
  updatedAt: string,
}
```

### Error message update

```
Unsupported entity type: "xxx". Supported: post, changelog, helpcenter_article, helpcenter_category
```

---

## 5. New Write Tools

All write tools require: `write:help-center` scope, admin role, feature flag check.

### 5a. `create_article`

**Annotation:** WRITE

**Schema:**

| Field        | Type               | Required | Description                                     |
| ------------ | ------------------ | -------- | ----------------------------------------------- |
| `categoryId` | string             | yes      | Category TypeID                                 |
| `title`      | string (max 200)   | yes      | Article title                                   |
| `content`    | string (max 50000) | yes      | Article content (markdown)                      |
| `slug`       | string (max 200)   | no       | URL slug (auto-generated from title if omitted) |

**Behavior:** Calls `createArticle(data, auth.principalId)`. Article is created as draft. Returns full article object (same shape as `get_details` for `helpcenter_article`).

**Description string:**

```
Create a new help center article (draft). Use update_article to publish it.

Examples:
- create_article({ categoryId: "helpcenter_category_01abc...", title: "Getting Started", content: "Welcome to..." })
- With custom slug: create_article({ categoryId: "helpcenter_category_01abc...", title: "FAQ", content: "...", slug: "frequently-asked-questions" })
```

### 5b. `update_article`

**Annotation:** WRITE

**Schema:**

| Field         | Type                      | Required | Description                              |
| ------------- | ------------------------- | -------- | ---------------------------------------- |
| `articleId`   | string                    | yes      | Article TypeID                           |
| `title`       | string (max 200)          | no       | New title                                |
| `content`     | string (max 50000)        | no       | New content                              |
| `slug`        | string (max 200)          | no       | New slug                                 |
| `categoryId`  | string                    | no       | Move to different category               |
| `publishedAt` | string (datetime) or null | no       | ISO string to publish, null to unpublish |

**Behavior:** Mirrors the REST API PATCH handler:

1. If `publishedAt` is a non-null string: call `publishArticle(articleId)`
2. If `publishedAt` is null: call `unpublishArticle(articleId)`
3. Remaining fields (title, content, slug, categoryId): call `updateArticle(articleId, data)` if any are present
4. If only publishedAt changed, fetch and return current article via `getArticleById()`

Returns full article object.

**Description string:**

```
Update a help center article. All fields optional — only provided fields change. Set publishedAt to an ISO datetime to publish, or null to unpublish.

Examples:
- Update title: update_article({ articleId: "helpcenter_article_01abc...", title: "New Title" })
- Publish: update_article({ articleId: "helpcenter_article_01abc...", publishedAt: "2026-04-08T00:00:00Z" })
- Unpublish: update_article({ articleId: "helpcenter_article_01abc...", publishedAt: null })
```

### 5c. `delete_article`

**Annotation:** DESTRUCTIVE

**Schema:**

| Field       | Type   | Required | Description    |
| ----------- | ------ | -------- | -------------- |
| `articleId` | string | yes      | Article TypeID |

**Behavior:** Calls `deleteArticle(articleId)` (soft-delete). Returns `{ deleted: true, id: articleId }`.

**Description string:**

```
Soft-delete a help center article.

Example:
- delete_article({ articleId: "helpcenter_article_01abc..." })
```

### 5d. `manage_category`

**Annotation:** DESTRUCTIVE (because delete is one of the actions)

**Schema:**

| Field         | Type                             | Required          | Description                |
| ------------- | -------------------------------- | ----------------- | -------------------------- |
| `action`      | 'create' \| 'update' \| 'delete' | yes               | Operation to perform       |
| `categoryId`  | string                           | for update/delete | Category TypeID            |
| `name`        | string (max 200)                 | for create        | Category name              |
| `slug`        | string (max 200)                 | no                | URL slug                   |
| `description` | string (max 2000), nullable      | no                | Category description       |
| `icon`        | string (max 50), nullable        | no                | Emoji icon                 |
| `parentId`    | string, nullable                 | no                | Parent category TypeID     |
| `isPublic`    | boolean                          | no                | Whether category is public |

**Behavior:**

- `create`: calls `createCategory(data)`, returns category object
- `update`: calls `updateCategory(categoryId, data)`, returns updated category
- `delete`: calls `deleteCategory(categoryId)`, returns `{ deleted: true, id: categoryId }`

**Description string:**

```
Create, update, or delete a help center category.

Examples:
- Create: manage_category({ action: "create", name: "Getting Started", icon: "🚀" })
- Update: manage_category({ action: "update", categoryId: "helpcenter_category_01abc...", name: "New Name" })
- Delete: manage_category({ action: "delete", categoryId: "helpcenter_category_01abc..." })
```

---

## 6. New Resource

### `quackback://help-center/categories`

Lists all categories with article counts. Gated by `read:help-center` scope + feature flag.

Calls `listCategories()`. Returns:

```typescript
;[
  {
    id: string,
    slug: string,
    name: string,
    description: string | null,
    icon: string | null,
    parentId: string | null,
    isPublic: boolean,
    position: number,
    articleCount: number,
  },
]
```

### `scopeGated` refactor

The existing `scopeGated` helper in `server.ts` hardcodes `read:feedback`. Refactor to accept scope as parameter:

```typescript
function scopeGated(
  auth: McpAuthContext,
  scope: McpScope,
  fn: ReadResourceCallback
): ReadResourceCallback
```

Existing callers updated to pass `'read:feedback'` explicitly. The new resource passes `'read:help-center'`.

---

## 7. File Change Summary

| File                                        | Changes                                                                              |
| ------------------------------------------- | ------------------------------------------------------------------------------------ |
| `mcp/types.ts`                              | Add `'read:help-center' \| 'write:help-center'` to `McpScope`                        |
| `mcp/handler.ts`                            | Add new scopes to `ALL_SCOPES`                                                       |
| `mcp/tools.ts`                              | Extend `search` + `get_details`, add 4 new tools, add feature flag import and helper |
| `mcp/server.ts`                             | Add resource, refactor `scopeGated` to accept scope param                            |
| `auth/index.ts`                             | Add scopes to oauthProvider config                                                   |
| `[.]well-known.oauth-protected-resource.ts` | Add to `scopes_supported`                                                            |
| `oauth/consent.tsx`                         | Add `SCOPE_LABELS` entries                                                           |

---

## 8. Testing Strategy

Unit tests for the new tools follow the existing pattern in `mcp/__tests__/handler.test.ts`:

- Mock domain services, verify tool handlers call correct services with correct args
- Test scope denial (missing `read:help-center` / `write:help-center`)
- Test feature flag denial (helpCenter disabled)
- Test role denial (non-admin for write tools)
- Test cursor entity validation in search

---

## 9. Doc header update

Update the JSDoc comment at the top of `tools.ts` to list the new tools (27 total).
