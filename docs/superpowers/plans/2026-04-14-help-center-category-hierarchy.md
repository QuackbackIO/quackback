# Help Center Category Hierarchy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the partially-implemented hierarchical category feature for the help center: add cycle detection, depth capping (max 3 levels), a parent picker in the admin UI, recursive breadcrumbs, recursive portal rendering, and cascade soft-delete for subtrees.

**Architecture:** The `kb_categories` table already has a self-referencing `parentId` column and the service/API/MCP layers already accept and return it — this plan closes the gaps. A new pure `category-tree.ts` helper module builds ancestor chains, descendant sets, depth, and subtree heights from the flat category list; `help-center.service.ts` uses it to validate create/update (cycle + depth) and to drive cascade soft-delete; the admin form grows a parent-picker dropdown that filters out self, descendants, and over-depth parents; `buildCategoryBreadcrumbs` walks the parent chain; the portal category page recursively renders nested subcategory groups.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL, TanStack Start, Vitest. No schema changes — the `parentId` column and its FK already exist.

**Spec decisions (locked):**

- **Max depth:** 3 levels (depths 0, 1, 2 — matches Intercom)
- **Single parent:** yes (already schema-enforced by scalar `parentId`)
- **Article listing:** direct-only (no descendant-inclusive queries — matches Intercom/Featurebase)
- **Delete:** cascade soft-delete — deleting a category soft-deletes all descendant categories and all articles inside them
- **Cycle detection:** a category cannot be moved under itself or any of its descendants
- **No schema migration** — `parentId` column, FK, and index already exist

---

## File Structure

**Create:**

- `apps/web/src/lib/server/domains/help-center/category-tree.ts` — pure helpers: `collectDescendantIds`, `collectDescendantIdsIncludingSelf`, `getCategoryDepth`, `getSubtreeMaxDepth`, `buildAncestorChain`, and the `MAX_CATEGORY_DEPTH` constant
- `apps/web/src/lib/server/domains/help-center/__tests__/category-tree.test.ts` — unit tests for the helpers

**Modify:**

- `apps/web/src/lib/server/domains/help-center/help-center.service.ts`:
  - `createCategory` — validate depth when a parentId is supplied
  - `updateCategory` — validate cycle + depth
  - `deleteCategory` — cascade soft-delete descendants + their articles in a transaction
- `apps/web/src/lib/server/domains/help-center/__tests__/help-center-service.test.ts` — new cases for cycle detection, depth cap, cascade delete (create the file or extend an existing one)
- `apps/web/src/components/help-center/help-center-utils.ts` — `buildCategoryBreadcrumbs` walks the ancestor chain instead of hardcoding two levels
- `apps/web/src/components/help-center/__tests__/help-center-utils.test.ts` — new breadcrumb cases
- `apps/web/src/components/admin/help-center/category-form-dialog.tsx` — add a parent picker dropdown, thread `parentId` through form state and submit payloads, extend `initialValues` type
- `apps/web/src/routes/hc/$categorySlug.tsx` — recursively render nested subcategories
- `apps/web/src/components/help-center/help-center-sidebar.tsx` — accept deeper nested subcategory data; render recursively (size cap where needed)

**Not touched in this plan:**

- `packages/db/src/schema/kb.ts` — schema already supports `parentId`
- `apps/web/src/lib/shared/schemas/help-center.ts` — zod schemas already accept `parentId`
- `apps/web/src/lib/server/mcp/tools.ts` `manage_category` tool — already accepts `parentId`
- `apps/web/src/routes/api/v1/help-center/categories/*` — REST handlers already accept `parentId`
- `listPublicArticlesForCategory` — stays direct-only (explicit decision)

---

## Preconditions

- [ ] **Step 0.1: Confirm clean baseline**

```bash
cd /home/james/quackback
git status
git log --oneline main..HEAD
```

Expected: on branch `feat/help-center-category-hierarchy`, nothing ahead of `main`. If the branch isn't checked out, `git checkout -b feat/help-center-category-hierarchy origin/main`.

- [ ] **Step 0.2: Baseline test + typecheck**

```bash
bun run test
bun run typecheck
```

Expected: all tests pass, typecheck clean. If not, STOP and fix before proceeding.

---

## Task 1: Create `category-tree.ts` pure helpers

**Context:** Every operation that validates or walks the hierarchy works from the flat category list already returned by `db.query.helpCenterCategories.findMany(...)`. Keeping these as pure functions that take a flat list + the target id(s) lets us unit-test them in isolation with plain fixtures, and lets both the service layer and the admin UI use the same helpers.

**Files:**

- Create: `apps/web/src/lib/server/domains/help-center/category-tree.ts`
- Create: `apps/web/src/lib/server/domains/help-center/__tests__/category-tree.test.ts`

- [ ] **Step 1.1: Write the failing tests**

Create `apps/web/src/lib/server/domains/help-center/__tests__/category-tree.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  MAX_CATEGORY_DEPTH,
  collectDescendantIds,
  collectDescendantIdsIncludingSelf,
  getCategoryDepth,
  getSubtreeMaxDepth,
  buildAncestorChain,
} from '../category-tree'

type TestCat = { id: string; parentId: string | null }

/**
 * Fixture tree:
 *   a (top)
 *   ├── b
 *   │   └── d
 *   └── c
 *   e (top, sibling of a)
 */
const flat: TestCat[] = [
  { id: 'a', parentId: null },
  { id: 'b', parentId: 'a' },
  { id: 'c', parentId: 'a' },
  { id: 'd', parentId: 'b' },
  { id: 'e', parentId: null },
]

describe('MAX_CATEGORY_DEPTH', () => {
  it('is 3', () => {
    expect(MAX_CATEGORY_DEPTH).toBe(3)
  })
})

describe('collectDescendantIds', () => {
  it('returns an empty set for a leaf', () => {
    expect(collectDescendantIds(flat, 'd')).toEqual(new Set())
  })
  it('returns direct children and grandchildren', () => {
    expect(collectDescendantIds(flat, 'a')).toEqual(new Set(['b', 'c', 'd']))
  })
  it('returns only direct child when there is one level', () => {
    expect(collectDescendantIds(flat, 'b')).toEqual(new Set(['d']))
  })
  it('returns an empty set when the id does not exist', () => {
    expect(collectDescendantIds(flat, 'zzz')).toEqual(new Set())
  })
})

describe('collectDescendantIdsIncludingSelf', () => {
  it('includes the root id plus all descendants', () => {
    expect(collectDescendantIdsIncludingSelf(flat, 'a')).toEqual(new Set(['a', 'b', 'c', 'd']))
  })
  it('returns just the id for a leaf', () => {
    expect(collectDescendantIdsIncludingSelf(flat, 'd')).toEqual(new Set(['d']))
  })
  it('returns an empty set when the id does not exist', () => {
    expect(collectDescendantIdsIncludingSelf(flat, 'zzz')).toEqual(new Set())
  })
})

describe('getCategoryDepth', () => {
  it('returns 0 for top-level categories', () => {
    expect(getCategoryDepth(flat, 'a')).toBe(0)
    expect(getCategoryDepth(flat, 'e')).toBe(0)
  })
  it('returns 1 for direct children of top-level', () => {
    expect(getCategoryDepth(flat, 'b')).toBe(1)
    expect(getCategoryDepth(flat, 'c')).toBe(1)
  })
  it('returns 2 for grandchildren', () => {
    expect(getCategoryDepth(flat, 'd')).toBe(2)
  })
  it('returns 0 for unknown id (treated as new top-level)', () => {
    expect(getCategoryDepth(flat, 'zzz')).toBe(0)
  })
})

describe('getSubtreeMaxDepth', () => {
  it('returns 0 for a leaf', () => {
    expect(getSubtreeMaxDepth(flat, 'd')).toBe(0)
    expect(getSubtreeMaxDepth(flat, 'c')).toBe(0)
    expect(getSubtreeMaxDepth(flat, 'e')).toBe(0)
  })
  it('returns 1 for a category with one level of children', () => {
    expect(getSubtreeMaxDepth(flat, 'b')).toBe(1)
  })
  it('returns 2 for a category with two levels of children', () => {
    expect(getSubtreeMaxDepth(flat, 'a')).toBe(2)
  })
  it('returns 0 when the id does not exist', () => {
    expect(getSubtreeMaxDepth(flat, 'zzz')).toBe(0)
  })
})

describe('buildAncestorChain', () => {
  it('returns only the category itself for a top-level node', () => {
    expect(buildAncestorChain(flat, 'a').map((c) => c.id)).toEqual(['a'])
  })
  it('walks up to the root for a leaf', () => {
    expect(buildAncestorChain(flat, 'd').map((c) => c.id)).toEqual(['a', 'b', 'd'])
  })
  it('returns an empty array when the id does not exist', () => {
    expect(buildAncestorChain(flat, 'zzz')).toEqual([])
  })
  it('bails out of a cycle rather than looping forever', () => {
    // Corrupted fixture where a -> b -> a (would never happen via the service,
    // but the helper must not hang if the DB somehow contains a cycle)
    const cyclic: TestCat[] = [
      { id: 'a', parentId: 'b' },
      { id: 'b', parentId: 'a' },
    ]
    expect(() => buildAncestorChain(cyclic, 'a')).not.toThrow()
    const chain = buildAncestorChain(cyclic, 'a')
    // Should terminate without repeating
    expect(chain.length).toBeLessThanOrEqual(2)
  })
})
```

- [ ] **Step 1.2: Run the test and watch it fail**

```bash
bun run test -- apps/web/src/lib/server/domains/help-center/__tests__/category-tree.test.ts
```

Expected: FAIL with module-not-found for `../category-tree`.

- [ ] **Step 1.3: Implement the module**

Create `apps/web/src/lib/server/domains/help-center/category-tree.ts`:

```ts
/**
 * Pure helpers for walking the help center category hierarchy.
 *
 * The full non-deleted category list is already cheap to load (the tree is
 * small and the DB has an index on parent_id). Everything here works over a
 * flat array so service callers can load once and run multiple checks.
 */

/** Maximum allowed depth of the category tree. */
export const MAX_CATEGORY_DEPTH = 3

interface CategoryLike {
  id: string
  parentId: string | null
}

/**
 * Collect the set of ids that are descendants of the given root.
 * Does NOT include the root itself. Safe in the presence of a cycle in the
 * input data — each node is visited at most once.
 */
export function collectDescendantIds<T extends CategoryLike>(
  flat: T[],
  rootId: string
): Set<string> {
  const byParent = new Map<string, T[]>()
  for (const cat of flat) {
    if (cat.parentId === null) continue
    const siblings = byParent.get(cat.parentId)
    if (siblings) siblings.push(cat)
    else byParent.set(cat.parentId, [cat])
  }

  const out = new Set<string>()
  const stack: string[] = [rootId]
  while (stack.length > 0) {
    const current = stack.pop()!
    const children = byParent.get(current)
    if (!children) continue
    for (const child of children) {
      if (out.has(child.id)) continue
      out.add(child.id)
      stack.push(child.id)
    }
  }
  return out
}

/** Same as collectDescendantIds, but the returned set also contains the root id. */
export function collectDescendantIdsIncludingSelf<T extends CategoryLike>(
  flat: T[],
  rootId: string
): Set<string> {
  const exists = flat.some((c) => c.id === rootId)
  if (!exists) return new Set()
  const out = collectDescendantIds(flat, rootId)
  out.add(rootId)
  return out
}

/**
 * Walk from the given category up to its top-level ancestor.
 * Depth is the number of ancestors above — 0 for top-level.
 *
 * Unknown ids return 0 (treated as a fresh top-level category). Cycles are
 * bailed out of after visiting more nodes than exist in the input.
 */
export function getCategoryDepth<T extends CategoryLike>(flat: T[], id: string): number {
  const byId = new Map(flat.map((c) => [c.id, c]))
  const start = byId.get(id)
  if (!start) return 0
  let depth = 0
  let current: T | undefined = start
  const seen = new Set<string>()
  while (current && current.parentId !== null) {
    if (seen.has(current.id)) break
    seen.add(current.id)
    const parent = byId.get(current.parentId)
    if (!parent) break
    depth++
    current = parent
    if (depth > flat.length) break
  }
  return depth
}

/**
 * Return the maximum depth of the subtree rooted at the given id, where a
 * leaf has height 0, a node with one layer of children has height 1, and so on.
 *
 * Unknown ids return 0.
 */
export function getSubtreeMaxDepth<T extends CategoryLike>(flat: T[], rootId: string): number {
  const byParent = new Map<string, T[]>()
  for (const cat of flat) {
    if (cat.parentId === null) continue
    const siblings = byParent.get(cat.parentId)
    if (siblings) siblings.push(cat)
    else byParent.set(cat.parentId, [cat])
  }

  function walk(id: string, visited: Set<string>): number {
    if (visited.has(id)) return 0
    visited.add(id)
    const children = byParent.get(id)
    if (!children || children.length === 0) return 0
    let max = 0
    for (const child of children) {
      const h = walk(child.id, visited)
      if (h + 1 > max) max = h + 1
    }
    return max
  }

  if (!flat.some((c) => c.id === rootId)) return 0
  return walk(rootId, new Set())
}

/**
 * Build the ancestor chain from the top-level ancestor down to (and including)
 * the given category. Returns an empty array if the id doesn't exist.
 */
export function buildAncestorChain<T extends CategoryLike>(flat: T[], id: string): T[] {
  const byId = new Map(flat.map((c) => [c.id, c]))
  const start = byId.get(id)
  if (!start) return []

  const chain: T[] = []
  const seen = new Set<string>()
  let current: T | undefined = start
  while (current) {
    if (seen.has(current.id)) break
    seen.add(current.id)
    chain.push(current)
    if (current.parentId === null) break
    current = byId.get(current.parentId)
  }
  return chain.reverse()
}
```

- [ ] **Step 1.4: Run the test and verify it passes**

```bash
bun run test -- apps/web/src/lib/server/domains/help-center/__tests__/category-tree.test.ts
```

Expected: all cases pass.

- [ ] **Step 1.5: Typecheck**

```bash
bun run typecheck
```

Expected: clean.

- [ ] **Step 1.6: Commit**

```bash
git add apps/web/src/lib/server/domains/help-center/category-tree.ts \
        apps/web/src/lib/server/domains/help-center/__tests__/category-tree.test.ts
git commit -m "feat(help-center): add category-tree helpers for hierarchy walks"
```

---

## Task 2: Add cycle detection + depth validation to createCategory / updateCategory

**Context:** Both `createCategory` and `updateCategory` currently accept a `parentId` but don't validate it. A user could set a category as its own parent, create cycles via a descendant, or bypass the 3-level cap. This task adds server-side validation using the new helpers.

**Files:**

- Modify: `apps/web/src/lib/server/domains/help-center/help-center.service.ts`
- Create or modify: `apps/web/src/lib/server/domains/help-center/__tests__/help-center-service.test.ts`

- [ ] **Step 2.1: Check whether the service test file exists**

```bash
ls apps/web/src/lib/server/domains/help-center/__tests__/
```

If a service test file exists, append the new cases to it. If not, create `help-center-service.test.ts` with the imports shown in Step 2.2.

- [ ] **Step 2.2: Write failing tests**

Append (or create) the following cases in `apps/web/src/lib/server/domains/help-center/__tests__/help-center-service.test.ts`. Use whatever mocking pattern the surrounding test file already uses — if it's a green-field file, mock the DB module:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { HelpCenterCategoryId } from '@quackback/ids'

// Mock the db module BEFORE importing the service
const mockCategoryFindMany = vi.fn()
const mockCategoryFindFirst = vi.fn()
const mockCategoryInsert = vi.fn()
const mockCategoryUpdate = vi.fn()
const mockArticleUpdate = vi.fn()
const mockTransaction = vi.fn()

vi.mock('@/lib/server/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/db')>()
  return {
    ...actual,
    db: {
      query: {
        helpCenterCategories: {
          findMany: mockCategoryFindMany,
          findFirst: mockCategoryFindFirst,
        },
      },
      insert: () => ({
        values: () => ({
          returning: () => mockCategoryInsert(),
        }),
      }),
      update: (table: unknown) => ({
        set: () => ({
          where: () => ({
            returning: () => {
              // The service calls update on both categories and articles; dispatch by the first invocation
              if ((table as { _?: { name?: string } })._?.name?.includes('article')) {
                return mockArticleUpdate()
              }
              return mockCategoryUpdate()
            },
          }),
        }),
      }),
      transaction: (fn: (tx: unknown) => unknown) => mockTransaction(fn),
    },
  }
})

// Import after mocking
const { createCategory, updateCategory, deleteCategory } = await import('../help-center.service')

const id = (s: string) => s as HelpCenterCategoryId

beforeEach(() => {
  vi.clearAllMocks()
  mockCategoryFindMany.mockResolvedValue([])
  mockCategoryFindFirst.mockResolvedValue(undefined)
  mockCategoryInsert.mockResolvedValue([{ id: 'new', name: 'X', slug: 'x', parentId: null }])
  mockCategoryUpdate.mockResolvedValue([{ id: 'cat-a', name: 'A', slug: 'a', parentId: null }])
  mockArticleUpdate.mockResolvedValue([])
  mockTransaction.mockImplementation((fn) =>
    fn({
      update: () => ({
        set: () => ({
          where: () => ({ returning: () => [] }),
        }),
      }),
    })
  )
})

describe('createCategory hierarchy validation', () => {
  it('rejects a parentId that already sits at the maximum depth', async () => {
    // parent 'c' is at depth 2 (a -> b -> c); adding a child would make depth 3
    mockCategoryFindMany.mockResolvedValue([
      { id: 'a', parentId: null },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'b' },
    ])
    await expect(createCategory({ name: 'Too Deep', parentId: 'c' })).rejects.toThrow(/depth/i)
  })

  it('allows a parentId at depth 1 (new category would land at depth 2)', async () => {
    mockCategoryFindMany.mockResolvedValue([
      { id: 'a', parentId: null },
      { id: 'b', parentId: 'a' },
    ])
    await expect(createCategory({ name: 'OK', parentId: 'b' })).resolves.toBeDefined()
  })

  it('allows a null parentId (new top-level category)', async () => {
    await expect(createCategory({ name: 'Top' })).resolves.toBeDefined()
  })
})

describe('updateCategory hierarchy validation', () => {
  it('rejects moving a category under itself', async () => {
    mockCategoryFindMany.mockResolvedValue([
      { id: 'a', parentId: null },
      { id: 'b', parentId: 'a' },
    ])
    await expect(updateCategory(id('a'), { parentId: 'a' })).rejects.toThrow(/cycle|parent/i)
  })

  it('rejects moving a category under its own descendant', async () => {
    mockCategoryFindMany.mockResolvedValue([
      { id: 'a', parentId: null },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'b' },
    ])
    // Moving 'a' under 'c' would create a cycle a -> c -> b -> a
    await expect(updateCategory(id('a'), { parentId: 'c' })).rejects.toThrow(/cycle/i)
  })

  it('rejects moving a subtree such that the deepest leaf would exceed MAX_CATEGORY_DEPTH', async () => {
    // Tree:
    //   a (depth 0)
    //     b (depth 1)
    //       c (depth 2)
    //   x (depth 0)
    //     y (depth 1)
    // Moving 'b' (subtree height 1) under 'y' (depth 1) would produce depth 2 for b, depth 3 for c — exceeds cap
    mockCategoryFindMany.mockResolvedValue([
      { id: 'a', parentId: null },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'b' },
      { id: 'x', parentId: null },
      { id: 'y', parentId: 'x' },
    ])
    await expect(updateCategory(id('b'), { parentId: 'y' })).rejects.toThrow(/depth/i)
  })

  it('allows setting parentId to null (promoting to top-level)', async () => {
    mockCategoryFindMany.mockResolvedValue([
      { id: 'a', parentId: null },
      { id: 'b', parentId: 'a' },
    ])
    await expect(updateCategory(id('b'), { parentId: null })).resolves.toBeDefined()
  })
})
```

**Important:** The exact `vi.mock` shape for `@/lib/server/db` depends on how the existing tests in the codebase mock it. If the surrounding test file uses a different mock pattern (for example a `MockDb` helper), mirror that instead of the ad-hoc mocks above. What matters is that `mockCategoryFindMany` drives `listCategories` / internal queries and the insert/update paths return plausible rows. If the mock shape gets messy, fall back to a real test DB if one is wired up in this repo; otherwise, STOP and report NEEDS_CONTEXT so I can show you the existing mock pattern.

- [ ] **Step 2.3: Run the tests and confirm failures**

```bash
bun run test -- apps/web/src/lib/server/domains/help-center/__tests__/help-center-service.test.ts
```

Expected: cycle / depth / parent cases FAIL (no validation yet), the two "allows" cases may either pass or fail depending on mock coverage. Continue regardless.

- [ ] **Step 2.4: Add the validation helper and wire it in**

Open `apps/web/src/lib/server/domains/help-center/help-center.service.ts`. Add the imports at the top alongside the existing imports:

```ts
import {
  MAX_CATEGORY_DEPTH,
  collectDescendantIdsIncludingSelf,
  getCategoryDepth,
  getSubtreeMaxDepth,
} from './category-tree'
```

Add a new private validation helper above `createCategory`:

```ts
/**
 * Validate that placing a subtree (rooted at `movingId`, or null for a brand-new
 * category being created) under `newParentId` will not:
 * - create a cycle (new parent is self or a descendant)
 * - exceed MAX_CATEGORY_DEPTH for any node in the resulting subtree
 *
 * Callers must load the current full flat list of non-deleted categories.
 */
function validateHierarchyConstraint(params: {
  flat: Array<{ id: string; parentId: string | null }>
  movingId: string | null
  newParentId: string | null
}): void {
  const { flat, movingId, newParentId } = params

  if (newParentId === null) {
    // Promoting to top-level is always safe: depth goes to 0, subtree height
    // can't exceed MAX_CATEGORY_DEPTH - 1 unless it was already over (in which
    // case something else is broken). We still validate the subtree in case
    // it has pre-existing over-depth descendants.
    if (movingId !== null) {
      const subtreeHeight = getSubtreeMaxDepth(flat, movingId)
      if (subtreeHeight + 1 > MAX_CATEGORY_DEPTH) {
        throw new ValidationError(
          'VALIDATION_ERROR',
          `Category subtree exceeds maximum depth of ${MAX_CATEGORY_DEPTH}`
        )
      }
    }
    return
  }

  // Self-parent
  if (movingId !== null && newParentId === movingId) {
    throw new ValidationError('VALIDATION_ERROR', 'A category cannot be its own parent')
  }

  // Cycle: new parent is a descendant of the moving category
  if (movingId !== null) {
    const descendants = collectDescendantIdsIncludingSelf(flat, movingId)
    if (descendants.has(newParentId)) {
      throw new ValidationError(
        'VALIDATION_ERROR',
        'A category cannot be moved under its own descendant (cycle)'
      )
    }
  }

  // Depth: parent's depth + 1 (moving category) + its subtree height must stay within the cap
  const parentExists = flat.some((c) => c.id === newParentId)
  if (!parentExists) {
    throw new NotFoundError('CATEGORY_NOT_FOUND', `Parent category ${newParentId} not found`)
  }

  const parentDepth = getCategoryDepth(flat, newParentId)
  const subtreeHeight = movingId === null ? 0 : getSubtreeMaxDepth(flat, movingId)
  // New depth of the moving node = parentDepth + 1; deepest leaf = that + subtreeHeight
  // Depths are 0-indexed and the cap is MAX_CATEGORY_DEPTH levels (depths 0..MAX-1)
  if (parentDepth + 1 + subtreeHeight > MAX_CATEGORY_DEPTH - 1) {
    throw new ValidationError(
      'VALIDATION_ERROR',
      `Placing this category here would exceed the maximum depth of ${MAX_CATEGORY_DEPTH}`
    )
  }
}
```

Then update `createCategory` to call the validator when `parentId` is supplied. Replace the current function body:

```ts
export async function createCategory(input: CreateCategoryInput): Promise<HelpCenterCategory> {
  const name = input.name?.trim()
  if (!name) throw new ValidationError('VALIDATION_ERROR', 'Name is required')

  const slug = input.slug?.trim() || slugify(name)

  if (input.parentId !== undefined && input.parentId !== null) {
    const flat = await db.query.helpCenterCategories.findMany({
      where: isNull(helpCenterCategories.deletedAt),
      columns: { id: true, parentId: true },
    })
    validateHierarchyConstraint({
      flat,
      movingId: null,
      newParentId: input.parentId as string,
    })
  }

  const [category] = await db
    .insert(helpCenterCategories)
    .values({
      name,
      slug,
      description: input.description?.trim() || null,
      isPublic: input.isPublic ?? true,
      position: input.position ?? 0,
      parentId: (input.parentId as HelpCenterCategoryId) ?? null,
      icon: input.icon ?? null,
    })
    .returning()

  return category
}
```

Update `updateCategory` to validate any `parentId` change. Replace the current function body:

```ts
export async function updateCategory(
  id: HelpCenterCategoryId,
  input: UpdateCategoryInput
): Promise<HelpCenterCategory> {
  const updateData: Partial<typeof helpCenterCategories.$inferInsert> = { updatedAt: new Date() }
  if (input.name !== undefined) updateData.name = input.name.trim()
  if (input.slug !== undefined) updateData.slug = input.slug.trim()
  if (input.description !== undefined) updateData.description = input.description?.trim() || null
  if (input.isPublic !== undefined) updateData.isPublic = input.isPublic
  if (input.position !== undefined) updateData.position = input.position
  if (input.icon !== undefined) updateData.icon = input.icon ?? null

  if (input.parentId !== undefined) {
    const flat = await db.query.helpCenterCategories.findMany({
      where: isNull(helpCenterCategories.deletedAt),
      columns: { id: true, parentId: true },
    })
    validateHierarchyConstraint({
      flat,
      movingId: id,
      newParentId: (input.parentId as string | null) ?? null,
    })
    updateData.parentId = (input.parentId as HelpCenterCategoryId) ?? null
  }

  const [updated] = await db
    .update(helpCenterCategories)
    .set(updateData)
    .where(and(eq(helpCenterCategories.id, id), isNull(helpCenterCategories.deletedAt)))
    .returning()

  if (!updated) throw new NotFoundError('CATEGORY_NOT_FOUND', `Category ${id} not found`)
  return updated
}
```

- [ ] **Step 2.5: Re-run tests and iterate**

```bash
bun run test -- apps/web/src/lib/server/domains/help-center/__tests__/help-center-service.test.ts
```

Expected: all the new cycle / depth / parent cases pass. If the existing happy-path tests break because of the new `findMany` call, extend the mocks accordingly.

- [ ] **Step 2.6: Typecheck**

```bash
bun run typecheck
```

- [ ] **Step 2.7: Commit**

```bash
git add apps/web/src/lib/server/domains/help-center/help-center.service.ts \
        apps/web/src/lib/server/domains/help-center/__tests__/help-center-service.test.ts
git commit -m "feat(help-center): validate parent cycles and depth cap for categories"
```

---

## Task 3: Cascade soft-delete descendants and their articles

**Context:** Today `deleteCategory` just sets `deletedAt` on the target row; the FK `onDelete: 'set null'` only fires on hard deletes, so children stay live with a dangling `parentId` and articles stay live under the deleted category. We need cascade soft-delete: delete → walk descendants → soft-delete every category in the subtree AND every article whose `categoryId` is in the subtree, all in one transaction.

**Files:**

- Modify: `apps/web/src/lib/server/domains/help-center/help-center.service.ts`
- Modify: `apps/web/src/lib/server/domains/help-center/__tests__/help-center-service.test.ts`

- [ ] **Step 3.1: Write failing tests**

Append to the service test file:

```ts
describe('deleteCategory cascade soft-delete', () => {
  it('soft-deletes a leaf category with no descendants', async () => {
    mockCategoryFindMany.mockResolvedValue([{ id: 'leaf', parentId: null }])
    mockCategoryUpdate.mockResolvedValue([{ id: 'leaf' }])

    await expect(deleteCategory(id('leaf'))).resolves.toBeUndefined()
  })

  it('soft-deletes all descendant categories in one call', async () => {
    mockCategoryFindMany.mockResolvedValue([
      { id: 'a', parentId: null },
      { id: 'b', parentId: 'a' },
      { id: 'c', parentId: 'a' },
      { id: 'd', parentId: 'b' },
    ])
    // Capture the ids that the transaction update-set was called with
    const categoryDeleteCalls: string[][] = []
    const articleDeleteCalls: string[][] = []
    mockTransaction.mockImplementation(async (fn) =>
      fn({
        update: (table: { _?: { name?: string } }) => ({
          set: () => ({
            where: (clause: unknown) => {
              // The `inArray` clause is serialized — our mock just records
              // the ids passed in. Use a side channel: parse the last arg.
              const captured = captureInArrayIds(clause)
              if (table._?.name?.includes('article')) {
                articleDeleteCalls.push(captured)
              } else {
                categoryDeleteCalls.push(captured)
              }
              return { returning: () => [] }
            },
          }),
        }),
      })
    )

    await deleteCategory(id('a'))

    // All four category ids should be in the update set
    expect(categoryDeleteCalls[0]?.sort()).toEqual(['a', 'b', 'c', 'd'])
    // The article update runs against the same set of category ids
    expect(articleDeleteCalls[0]?.sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('throws NotFound when the category does not exist', async () => {
    mockCategoryFindMany.mockResolvedValue([])
    await expect(deleteCategory(id('nope'))).rejects.toThrow(/not found/i)
  })
})

/** Extract ids from a Drizzle `inArray` SQL fragment. */
function captureInArrayIds(clause: unknown): string[] {
  // Drizzle produces SQLWrapper objects; the mock DB layer doesn't care about
  // execution, so we walk the serialized form to find the id list.
  const seen = new Set<string>()
  const walk = (value: unknown): void => {
    if (typeof value === 'string' && /^[a-z0-9_]{1,64}$/i.test(value)) {
      seen.add(value)
    } else if (Array.isArray(value)) {
      value.forEach(walk)
    } else if (value && typeof value === 'object') {
      Object.values(value as Record<string, unknown>).forEach(walk)
    }
  }
  walk(clause)
  return [...seen]
}
```

**Note on the id-extraction helper:** the mock is intentionally permissive — the real guarantee comes from the integration of `collectDescendantIdsIncludingSelf` which is already unit-tested in Task 1. If the helper above produces false positives in your test environment (e.g. picks up table column names), replace it with a spy that wraps `collectDescendantIdsIncludingSelf` directly and asserts on that function's output instead.

- [ ] **Step 3.2: Run the tests and confirm failures**

```bash
bun run test -- apps/web/src/lib/server/domains/help-center/__tests__/help-center-service.test.ts
```

Expected: the three new cascade cases fail.

- [ ] **Step 3.3: Implement cascade soft-delete**

Replace `deleteCategory` in `help-center.service.ts` with:

```ts
export async function deleteCategory(id: HelpCenterCategoryId): Promise<void> {
  const flat = await db.query.helpCenterCategories.findMany({
    where: isNull(helpCenterCategories.deletedAt),
    columns: { id: true, parentId: true },
  })
  if (!flat.some((c) => c.id === id)) {
    throw new NotFoundError('CATEGORY_NOT_FOUND', `Category ${id} not found`)
  }

  const toDelete = collectDescendantIdsIncludingSelf(flat, id)
  const ids = [...toDelete] as HelpCenterCategoryId[]
  const now = new Date()

  await db.transaction(async (tx) => {
    await tx
      .update(helpCenterCategories)
      .set({ deletedAt: now })
      .where(and(inArray(helpCenterCategories.id, ids), isNull(helpCenterCategories.deletedAt)))
    await tx
      .update(helpCenterArticles)
      .set({ deletedAt: now })
      .where(and(inArray(helpCenterArticles.categoryId, ids), isNull(helpCenterArticles.deletedAt)))
  })
}
```

`inArray` is already imported at the top of the file — verify by grepping; if not, add it to the `@/lib/server/db` import line.

- [ ] **Step 3.4: Re-run tests**

```bash
bun run test -- apps/web/src/lib/server/domains/help-center/__tests__/help-center-service.test.ts
```

Expected: all cases pass.

- [ ] **Step 3.5: Typecheck + commit**

```bash
bun run typecheck
git add apps/web/src/lib/server/domains/help-center/help-center.service.ts \
        apps/web/src/lib/server/domains/help-center/__tests__/help-center-service.test.ts
git commit -m "feat(help-center): cascade soft-delete descendant categories and articles"
```

---

## Task 4: Recursive breadcrumbs

**Context:** `buildCategoryBreadcrumbs` currently hardcodes `[Help Center, Category, Article?]` — a user viewing a grandchild category sees no hint of the intermediate parent. Rewrite it to walk the ancestor chain using the helper from Task 1 (which lives in the server domain module — we'll move / duplicate the pure walker to keep `help-center-utils.ts` client-safe).

**Files:**

- Modify: `apps/web/src/components/help-center/help-center-utils.ts`
- Modify: `apps/web/src/components/help-center/__tests__/help-center-utils.test.ts`

- [ ] **Step 4.1: Decide the helper location**

`help-center-utils.ts` is client-safe and takes `CategoryLike` — it already has `getTopLevelCategories` and `getSubcategories`. Add a small `buildAncestorChain` there too (duplicating the tiny helper from Task 1 — these are trivial walks and avoiding a server→client import keeps the bundle clean). Alternatively, move `buildAncestorChain` into a shared `lib/shared/` module and import it from both sides. Pick whichever matches the existing codebase convention — grep for how `getSubcategories` is used to see if client code pulls from a shared module.

For this plan: **duplicate the walker into `help-center-utils.ts`**. The function is six lines, the duplication cost is lower than the refactor cost.

- [ ] **Step 4.2: Write failing tests**

Open `apps/web/src/components/help-center/__tests__/help-center-utils.test.ts` and add new cases:

```ts
import {
  buildCategoryBreadcrumbs,
  // existing imports unchanged
} from '../help-center-utils'

describe('buildCategoryBreadcrumbs (hierarchical)', () => {
  const tree = [
    { id: 'root', parentId: null, slug: 'root', name: 'Root' },
    { id: 'mid', parentId: 'root', slug: 'mid', name: 'Middle' },
    { id: 'leaf', parentId: 'mid', slug: 'leaf', name: 'Leaf' },
  ]

  it('returns Help Center > Category for a top-level category', () => {
    const items = buildCategoryBreadcrumbs({
      allCategories: tree,
      categoryId: 'root',
    })
    expect(items.map((i) => i.label)).toEqual(['Help Center', 'Root'])
    expect(items[0].href).toBe('/hc')
    expect(items[1].href).toBeUndefined()
  })

  it('walks the full chain for a nested category', () => {
    const items = buildCategoryBreadcrumbs({
      allCategories: tree,
      categoryId: 'leaf',
    })
    expect(items.map((i) => i.label)).toEqual(['Help Center', 'Root', 'Middle', 'Leaf'])
    expect(items[1].href).toBe('/hc/root')
    expect(items[2].href).toBe('/hc/mid')
    expect(items[3].href).toBeUndefined()
  })

  it('appends the article title as a final non-linked crumb', () => {
    const items = buildCategoryBreadcrumbs({
      allCategories: tree,
      categoryId: 'leaf',
      articleTitle: 'Installing the CLI',
    })
    expect(items.map((i) => i.label)).toEqual([
      'Help Center',
      'Root',
      'Middle',
      'Leaf',
      'Installing the CLI',
    ])
    expect(items[3].href).toBe('/hc/leaf')
    expect(items[4].href).toBeUndefined()
  })

  it('falls back to just Help Center > Category when the ancestor chain is missing', () => {
    // Broken data: category references a parent that no longer exists
    const orphan = [{ id: 'x', parentId: 'ghost', slug: 'x', name: 'X' }]
    const items = buildCategoryBreadcrumbs({
      allCategories: orphan,
      categoryId: 'x',
    })
    expect(items.map((i) => i.label)).toEqual(['Help Center', 'X'])
  })
})
```

- [ ] **Step 4.3: Run the tests and confirm failures**

```bash
bun run test -- apps/web/src/components/help-center/__tests__/help-center-utils.test.ts
```

Expected: the new hierarchical cases fail (current signature takes `{categoryName, categorySlug, articleTitle?}`, not `{allCategories, categoryId, articleTitle?}`).

- [ ] **Step 4.4: Rewrite `buildCategoryBreadcrumbs`**

Replace the existing function in `help-center-utils.ts`:

```ts
interface CategoryLikeWithSlug {
  id: string
  parentId?: string | null
  slug: string
  name: string
}

/**
 * Walk from the given category up to its top-level ancestor.
 * Returns the chain root-to-leaf. Empty array if id unknown.
 */
function buildAncestorChain<T extends CategoryLikeWithSlug>(flat: T[], id: string): T[] {
  const byId = new Map(flat.map((c) => [c.id, c]))
  const start = byId.get(id)
  if (!start) return []
  const chain: T[] = []
  const seen = new Set<string>()
  let current: T | undefined = start
  while (current) {
    if (seen.has(current.id)) break
    seen.add(current.id)
    chain.push(current)
    if (!current.parentId) break
    current = byId.get(current.parentId)
  }
  return chain.reverse()
}

/**
 * Builds breadcrumb items walking the full ancestor chain of a category.
 * Each non-final crumb links to its category page; the final crumb (article
 * title if provided, otherwise the category name) has no href.
 */
export function buildCategoryBreadcrumbs<T extends CategoryLikeWithSlug>(params: {
  allCategories: T[]
  categoryId: string
  articleTitle?: string
}): Array<{ label: string; href?: string }> {
  const chain = buildAncestorChain(params.allCategories, params.categoryId)
  const items: Array<{ label: string; href?: string }> = [{ label: 'Help Center', href: '/hc' }]

  if (chain.length === 0) {
    // Fallback: we don't have the chain at all (broken data). Emit a minimal
    // trail using whatever the caller gave us — this keeps the UI from
    // crashing even when the DB has dangling parentIds.
    if (params.articleTitle) items.push({ label: params.articleTitle })
    return items
  }

  chain.forEach((cat, index) => {
    const isLast = index === chain.length - 1
    if (isLast && !params.articleTitle) {
      items.push({ label: cat.name })
    } else {
      items.push({ label: cat.name, href: `/hc/${cat.slug}` })
    }
  })

  if (params.articleTitle) {
    items.push({ label: params.articleTitle })
  }

  return items
}
```

- [ ] **Step 4.5: Update call sites**

Grep for existing `buildCategoryBreadcrumbs` callers:

```bash

```

Use Grep with pattern `buildCategoryBreadcrumbs` across `apps/web/src`. Each call site currently passes `{categoryName, categorySlug, articleTitle?}` — update them to pass `{allCategories, categoryId, articleTitle?}`. The call sites should already have access to the category list via their loader data; if one doesn't, add a fetch to its loader. Expected touch points:

- `apps/web/src/routes/hc/$categorySlug/index.tsx`
- `apps/web/src/routes/hc/$categorySlug/$articleSlug.tsx`

(If the feat/help-center-inline-in-portal branch has been merged by the time you run this plan, the paths will instead live under `apps/web/src/routes/_portal/hc/...` — update whichever version is current on main.)

- [ ] **Step 4.6: Re-run the unit tests**

```bash
bun run test -- apps/web/src/components/help-center/
```

Expected: pass. If a call-site test breaks because of the signature change, update the call site's fixtures to provide `allCategories` and `categoryId`.

- [ ] **Step 4.7: Typecheck + commit**

```bash
bun run typecheck
git add apps/web/src/components/help-center/ apps/web/src/routes/hc/
git commit -m "feat(help-center): render recursive breadcrumbs walking the parent chain"
```

---

## Task 5: Admin UI parent picker

**Context:** The admin category form doesn't expose `parentId` at all. Admins can't create or move nested categories from the UI — only via the REST/MCP API. Add a parent dropdown that fetches the full category list, filters out invalid options (self + descendants + over-depth parents), and threads `parentId` through form state and the submit payload.

**Files:**

- Modify: `apps/web/src/components/admin/help-center/category-form-dialog.tsx`

- [ ] **Step 5.1: Find the right query hook**

Grep for how other admin help-center surfaces list categories:

```bash

```

Use Grep for patterns `useCategoriesQuery`, `listCategoriesFn`, `helpCenterKeys.categories()` in `apps/web/src/lib/client`. Confirm the hook name and its return shape. If no client-side hook exists yet, the form can fetch via `useQuery({ queryKey: helpCenterKeys.categories(), queryFn: () => listCategoriesFn({ data: {} }) })` using the existing `listCategoriesFn` server function. Use whatever pattern is already in use by `apps/web/src/routes/admin/help-center/*` pages.

- [ ] **Step 5.2: Extend `initialValues` type**

At the top of `category-form-dialog.tsx`, update the `initialValues` prop shape to include `parentId`:

```ts
interface CategoryFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialValues?: {
    id: HelpCenterCategoryId
    name: string
    description: string | null
    icon: string | null
    isPublic: boolean
    parentId: HelpCenterCategoryId | null
  }
  onCreated?: (categoryId: string) => void
}
```

Also add form state for `parentId`:

```ts
const [parentId, setParentId] = useState<HelpCenterCategoryId | null>(null)
```

And extend the `useEffect` that resets state on open:

```ts
useEffect(() => {
  if (open) {
    setIcon(initialValues?.icon || DEFAULT_EMOJI)
    setName(initialValues?.name || '')
    setDescription(initialValues?.description || '')
    setIsPublic(initialValues?.isPublic ?? true)
    setParentId(initialValues?.parentId ?? null)
  }
}, [open, initialValues])
```

- [ ] **Step 5.3: Fetch categories and compute eligible parents**

At the top of the component body, after the mutation hooks:

```ts
import { useQuery } from '@tanstack/react-query'
import { listCategoriesFn } from '@/lib/server/functions/help-center'
import { helpCenterKeys } from '@/lib/client/queries/help-center'
import {
  MAX_CATEGORY_DEPTH,
  collectDescendantIdsIncludingSelf,
  getCategoryDepth,
  getSubtreeMaxDepth,
} from '@/lib/server/domains/help-center/category-tree'
```

**Note on server-domain imports from a client file:** the helpers in `category-tree.ts` are pure TypeScript with no server-only dependencies, so importing them from a client component is safe. If your project enforces a client/server import boundary that rejects `@/lib/server/domains/*` from a component, move `category-tree.ts` under `lib/shared/help-center/` first and update Task 1's imports accordingly. Check whether CLAUDE.md or any lint rule already enforces this boundary and adjust before wiring the import.

Inside the component body:

```ts
const { data: allCategories = [] } = useQuery({
  queryKey: helpCenterKeys.categories(),
  queryFn: () => listCategoriesFn({ data: {} }),
  // This dialog is opened on demand; only fetch when it's actually open
  enabled: open,
})

const eligibleParents = (() => {
  // Exclude self + all descendants of self (cycle / self-parent)
  const excluded = new Set<string>()
  if (initialValues?.id) {
    for (const ex of collectDescendantIdsIncludingSelf(
      allCategories as Array<{ id: string; parentId: string | null }>,
      initialValues.id
    )) {
      excluded.add(ex)
    }
  }

  // Compute this category's subtree height (0 for a new category)
  const subtreeHeight = initialValues?.id
    ? getSubtreeMaxDepth(
        allCategories as Array<{ id: string; parentId: string | null }>,
        initialValues.id
      )
    : 0

  return allCategories.filter((cat) => {
    if (excluded.has(cat.id)) return false
    const parentDepth = getCategoryDepth(
      allCategories as Array<{ id: string; parentId: string | null }>,
      cat.id
    )
    // Putting this category under `cat` makes its depth parentDepth+1, plus
    // its subtree height. Reject parents that would push any node past the cap.
    return parentDepth + 1 + subtreeHeight <= MAX_CATEGORY_DEPTH - 1
  })
})()
```

- [ ] **Step 5.4: Render the parent picker**

Add a new form field block inside the `<form>` just below the description input (before the "Public" switch), using the shared shadcn `Select` component:

```tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
```

```tsx
<div className="space-y-2">
  <Label htmlFor="category-parent">Parent category</Label>
  <Select
    value={parentId ?? '__none__'}
    onValueChange={(value) =>
      setParentId(value === '__none__' ? null : (value as HelpCenterCategoryId))
    }
  >
    <SelectTrigger id="category-parent">
      <SelectValue placeholder="No parent (top-level)" />
    </SelectTrigger>
    <SelectContent>
      <SelectItem value="__none__">No parent (top-level)</SelectItem>
      {eligibleParents.map((cat) => (
        <SelectItem key={cat.id} value={cat.id}>
          {cat.icon ?? '📁'} {cat.name}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
  <p className="text-xs text-muted-foreground">
    Maximum depth is {MAX_CATEGORY_DEPTH} levels. Parents that would exceed it are hidden.
  </p>
</div>
```

- [ ] **Step 5.5: Include `parentId` in the submit payload**

Update `handleSubmit` so both create and update pass the new value:

```ts
if (isEdit) {
  await updateCategory.mutateAsync({
    id: initialValues.id,
    name: trimmedName,
    description: trimmedDesc || null,
    icon,
    isPublic,
    parentId,
  })
} else {
  const result = await createCategory.mutateAsync({
    name: trimmedName,
    description: trimmedDesc || undefined,
    icon,
    isPublic,
    parentId,
  })
  onCreated?.(result.id)
}
```

- [ ] **Step 5.6: Update any caller that builds `initialValues`**

Grep for `CategoryFormDialog` usages:

```bash

```

Use Grep for `CategoryFormDialog` in `apps/web/src`. Every site that passes `initialValues` now also needs to pass `parentId` (usually it's on the category object already — add `parentId: category.parentId`). If any call site passes a shape that doesn't have the parentId available, load it into the surrounding query first.

- [ ] **Step 5.7: Typecheck**

```bash
bun run typecheck
```

Expected: clean.

- [ ] **Step 5.8: Manual smoke test in the admin UI**

Start the dev server (if one isn't already running, `bun run dev`). Log in as `demo@example.com` / `password`, go to admin → help center → categories:

1. Create a new top-level category "Getting Started" — parent picker defaults to "No parent".
2. Create a child "First Steps" with parent "Getting Started".
3. Create a grandchild "Account Setup" under "First Steps".
4. Try to create a fourth-level "Nope" under "Account Setup" — "Account Setup" should not appear in the dropdown (it's at the max depth).
5. Edit "Getting Started" and try to set its parent to "Account Setup" — "Account Setup" should not appear in the dropdown (it's a descendant).
6. Edit "Getting Started" and set its parent to `null` — still works (top-level).

If any of these fail, iterate on the filter logic in Step 5.3.

- [ ] **Step 5.9: Commit**

```bash
git add apps/web/src/components/admin/help-center/category-form-dialog.tsx apps/web/src/routes/admin/
git commit -m "feat(help-center): add parent picker to admin category form"
```

---

## Task 6: Recursive portal render

**Context:** The portal category page currently renders one level of subcategories via a single `getSubcategories()` call. With the 3-level cap in place we now need to render two levels of nesting (grandchildren) so the full tree is walkable from a top-level category.

**Files:**

- Modify: `apps/web/src/routes/hc/$categorySlug.tsx`
- Modify: `apps/web/src/components/help-center/help-center-sidebar.tsx`

- [ ] **Step 6.1: Read the current sidebar implementation**

Read `apps/web/src/components/help-center/help-center-sidebar.tsx` to see how it renders the current one-level `subcategories` array. The component currently expects `subcategories: Array<{id, slug, name, icon, articles: Article[]}>`. We're extending that to optionally include nested children.

- [ ] **Step 6.2: Extend the loader to walk two levels**

In `apps/web/src/routes/hc/$categorySlug.tsx` (or `apps/web/src/routes/_portal/hc/$categorySlug.tsx` if the inline branch is on main), replace the current loader body:

```ts
loader: async ({ params }) => {
  let category: Awaited<ReturnType<typeof getPublicCategoryBySlugFn>>
  try {
    category = await getPublicCategoryBySlugFn({ data: { slug: params.categorySlug } })
  } catch {
    throw notFound()
  }

  const [articles, allCategories] = await Promise.all([
    listPublicArticlesForCategoryFn({ data: { categoryId: category.id } }),
    listPublicCategoriesFn({ data: {} }),
  ])

  const directChildren = getSubcategories(allCategories, category.id)

  // For each direct child, load its articles AND its grandchildren (with articles).
  const subcategoryTree = await Promise.all(
    directChildren.map(async (sub) => {
      const [subArticles, grandchildren] = [
        await listPublicArticlesForCategoryFn({ data: { categoryId: sub.id } }),
        getSubcategories(allCategories, sub.id),
      ]
      const grandchildrenWithArticles = await Promise.all(
        grandchildren.map(async (grand) => ({
          ...grand,
          articles: await listPublicArticlesForCategoryFn({ data: { categoryId: grand.id } }),
        }))
      )
      return {
        ...sub,
        articles: subArticles,
        children: grandchildrenWithArticles,
      }
    })
  )

  return { category, articles, subcategories: subcategoryTree, allCategories }
},
```

**Perf note:** the number of requests scales with the size of the subtree (O(children + grandchildren)). Since depth is capped at 3 and the number of grandchildren for a typical help center is small, this is fine for v1. If a future workspace has hundreds of grandchildren, switch to a single `listPublicCategoryTreeFn` server function that returns the whole tree in one call.

- [ ] **Step 6.3: Extend the sidebar to render grandchildren**

Open `apps/web/src/components/help-center/help-center-sidebar.tsx`. Extend the `subcategories` prop type to allow `children: SubcategoryWithArticles[]` (recursive). Inside the render, when a subcategory has `children`, render them below the subcategory's articles using the same visual style one indentation level deeper. Use your judgment on exact markup — the goal is that a user viewing "Getting Started" sees:

```
Getting Started
  [articles of Getting Started]
  First Steps
    [articles of First Steps]
    Account Setup
      [articles of Account Setup]
  Billing
    [articles of Billing]
```

If the sidebar is already using a recursive render pattern, just update the data shape. If it's a flat map, refactor to a small recursive component:

```tsx
function SubcategoryGroup({
  subcategory,
  depth,
}: {
  subcategory: SubcategoryWithArticles
  depth: number
}) {
  return (
    <div className={cn('space-y-1', depth > 0 && 'ml-4 border-l border-border/30 pl-3')}>
      <h3 className="text-sm font-medium text-foreground">
        {subcategory.icon && <span className="mr-1">{subcategory.icon}</span>}
        {subcategory.name}
      </h3>
      {subcategory.articles.length > 0 && (
        <ul className="space-y-1">
          {subcategory.articles.map((article) => (
            <li key={article.id}>
              <a
                href={`/hc/${subcategory.slug}/${article.slug}`}
                className="text-sm text-muted-foreground hover:text-foreground"
              >
                {article.title}
              </a>
            </li>
          ))}
        </ul>
      )}
      {subcategory.children?.map((child) => (
        <SubcategoryGroup key={child.id} subcategory={child} depth={depth + 1} />
      ))}
    </div>
  )
}
```

Render it from the sidebar's main component. Preserve any existing class names / design tokens the current sidebar uses — match the existing visual style, don't invent new ones.

- [ ] **Step 6.4: Typecheck + manual check**

```bash
bun run typecheck
```

Start the dev server, navigate to a top-level category with nested children created in Task 5's smoke test, confirm the full two-level tree renders in the sidebar and that clicking any nested article still navigates correctly.

- [ ] **Step 6.5: Commit**

```bash
git add apps/web/src/routes/hc/ apps/web/src/components/help-center/help-center-sidebar.tsx
git commit -m "feat(help-center): render two levels of nested subcategories in portal"
```

---

## Task 7: Final verification

- [ ] **Step 7.1: Full lint / typecheck / test / build**

```bash
bun run lint 2>&1 | tail -15
bun run typecheck
bun run test
bun run build
```

Expected: lint clean (pre-existing warnings OK), typecheck clean, all tests pass, build succeeds. Baseline test count is approximately 1655; this plan adds roughly 20-25 new cases across category-tree, service validation, and breadcrumbs — expect ≥1675 total.

- [ ] **Step 7.2: Review the branch diff**

```bash
git log --oneline main..HEAD
git diff --stat main..HEAD
```

Sanity check — the diff should be confined to:

- `apps/web/src/lib/server/domains/help-center/` (new helpers, modified service, new service tests)
- `apps/web/src/components/help-center/` (utils + sidebar)
- `apps/web/src/components/admin/help-center/` (form dialog)
- `apps/web/src/routes/hc/` (loader update)
- Callers that pass `initialValues` to `CategoryFormDialog`
- This plan doc

No schema migrations, no MCP tool changes, no REST route changes.

- [ ] **Step 7.3: Done**

Cycle detection, depth cap, cascade soft-delete, admin parent picker, recursive breadcrumbs, and recursive portal render are all live. Admins can build arbitrary three-level category trees; moving or deleting a category behaves predictably; the portal renders the full tree.

---

## Risks & open items

1. **Cascade soft-delete has no user confirmation step yet.** The admin UI just calls `useDeleteCategory()`. If a user accidentally deletes a category with 50 articles beneath it, everything disappears at once. Data is recoverable via `deletedAt = null` in SQL, but there's no restore flow in the UI. **Flagged as a follow-up:** either add a confirmation modal that shows the descendant count ("This will delete 3 sub-categories and 14 articles") or add a category restore endpoint. Out of scope for this plan.

2. **No restore flow for articles dragged along by cascade delete.** Articles soft-deleted as part of a parent-category cascade can only be restored by un-deleting them in the DB. If admins need a UI for this, it's a follow-up feature.

3. **Client-side import of server-domain module.** Task 5 imports `category-tree.ts` from the admin form. The helpers are pure TypeScript so this is safe, but if the repo has a lint rule that forbids `@/lib/server/domains/*` imports from `components/`, move the helpers under `lib/shared/help-center/` first. Verify before implementing Task 5.

4. **Two-level hardcoded render in portal (Task 6) instead of arbitrary depth.** With MAX_CATEGORY_DEPTH = 3 the loader walks two levels of descendants explicitly. If the cap is ever raised, the loader needs a recursive helper that walks to depth N. Left as-is because unrolling two levels is clearer than recursion for this scale.

5. **Perf on large trees.** The two-level loader fires one article-list query per direct child + one per grandchild. For a top-level category with 20 children × 10 grandchildren each, that's 201 DB round-trips per page load. If this becomes an issue, add a single `listArticlesForCategoryTreeFn` server function that returns all articles for a subtree in one query — but wait for real data before over-optimizing.

6. **The existing flat-list `listCategories` query.** Both `createCategory` and `updateCategory` now load the full category list on every write. The help center category table is small (typically < 100 rows) and has an index on `parent_id`, so this is fine, but worth noting as a scaling risk if a workspace ever has thousands of categories.
