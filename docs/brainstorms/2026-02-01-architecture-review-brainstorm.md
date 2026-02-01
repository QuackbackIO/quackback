---
date: 2026-02-01
topic: architecture-review
---

# Architecture Review: Quackback Codebase

## What We Found

A comprehensive review of the Quackback codebase identified architectural issues across four major areas: **component organization**, **service layer**, **code organization**, and **testing coverage**. The codebase has grown organically and would benefit from targeted refactoring.

## Critical Issues (High Priority)

### 1. God Components

Several components exceed 500+ lines and handle too many concerns:

| Component                    | Lines | Problem                                                                |
| ---------------------------- | ----- | ---------------------------------------------------------------------- |
| `post.service.ts`            | 1,439 | Monolithic service handling CRUD, voting, queries, admin ops, comments |
| `use-inbox-queries.ts`       | 695   | Mixes query definitions, mutations, and key factories                  |
| `active-filters-bar.tsx`     | 661   | Filter UI + state management + popover logic                           |
| `status-list.tsx`            | 642   | Drag-n-drop + CRUD + color picker + dialogs                            |
| `feedback.posts.$postId.tsx` | 512   | Full page duplicate of modal functionality                             |
| `post-modal.tsx`             | 528   | Modal + vote sidebar + metadata + comments + edit dialog               |

**Impact**: Hard to test, hard to modify without side effects, cognitive overload.

### 2. PostCard Mixed-Mode Component

`post-card.tsx` (450 lines, 24 props) handles both portal and admin modes:

```typescript
// Props mixing portal-only and admin-only concerns
interface PostCardProps {
  // Portal mode
  isAuthenticated?: boolean
  canEdit?: boolean
  onEdit?: () => void

  // Admin mode
  canChangeStatus?: boolean
  onStatusChange?: (statusId: StatusId) => void
  isFocused?: boolean
  onClick?: () => void
}
```

Uses `useAuthPopoverSafe()` hook to handle auth context that doesn't exist in admin mode.

**Impact**: Testing requires understanding both modes. Changes to one mode risk breaking the other.

### 3. Cross-Layer Type Imports

Types flow from components → lib (wrong direction):

```typescript
// lib/hooks/use-inbox-queries.ts
import type { InboxFilters } from '@/components/admin/feedback/use-inbox-filters'

// lib/hooks/use-public-posts-query.ts
import type { PublicFeedbackFilters } from '@/components/public/feedback/use-public-filters'

// lib/hooks/use-users-queries.ts
import type { UsersFilters } from '@/components/admin/users/use-users-filters'
```

**Impact**: Creates circular dependency risk. Types should flow lib → components, not reverse.

### 4. Duplicate Modal Implementations

Two implementations of post detail view exist:

- `post-modal.tsx` - New unified modal
- `routes/admin/feedback.posts.$postId.tsx` - Full-page route (512 lines)

Both import from `@/components/public/post-detail/*` and duplicate data transformation logic.

**Impact**: Maintenance burden, divergent behavior over time.

### 5. Zero Component Test Coverage

No unit tests exist for:

- `/components/admin/feedback/*` (12+ components)
- `/components/public/*` (8+ components)
- `/components/admin/settings/*` (complex stateful components)

**Impact**: Refactoring is risky without test coverage.

## Medium Priority Issues

### 6. Service Layer Over-Consolidation

`post.service.ts` handles too many domains:

- Lines 1-200: createPost, updatePost, softDeletePost
- Lines 200-400: voteOnPost, getPostPermissions
- Lines 400-700: listInboxPosts (50+ line query building)
- Lines 700-900: Status/tag/roadmap operations
- Lines 900-1439: Comment operations, reactions

### 7. Hook Organization

`use-inbox-queries.ts` (695 lines) exports 8+ functions mixing concerns:

- Query key factories
- 5 different query hooks
- 3 mutation hooks (status, tags, create)
- Comment mutations

### 8. Type Definition Fragmentation

Types scattered across 8+ files:

- `inbox-types.ts` - Component-level
- `post.types.ts` - Service-level
- `portal-detail.ts` - Query response types
- `db-types.ts` - Database types
- Inline types in various files

Similar structures redefined in multiple places.

### 9. Inconsistent Naming

- `fetchInboxPosts` vs `listInboxPosts` vs `useInboxPosts`
- `userEditPost` vs `updatePost` vs `editPost`
- Server functions: `somethingFn` suffix inconsistent

## Recommendations

### Short-Term (Incremental)

1. **Split PostCard**: Create `AdminPostCard` and `PortalPostCard` with shared `PostCardBase`

2. **Move filter types to lib**: Create `/lib/types/filters.ts` for `InboxFilters`, `PublicFeedbackFilters`, etc.

3. **Delete duplicate route**: Remove `feedback.posts.$postId.tsx` once modal fully replaces it

4. **Split mega hooks**:
   - `use-inbox-queries.ts` → `use-inbox-list-query.ts`, `use-inbox-mutations.ts`
   - One hook type per file

5. **Add component tests**: Start with PostCard and StatusList

### Long-Term (Refactoring)

1. **Split post.service.ts**:
   - `post.crud.ts` - Create/update/delete
   - `post.voting.ts` - Vote operations
   - `post.query.ts` - List/filter operations
   - `post.admin.ts` - Status, tags, roadmaps
   - Keep comments in `comment.service.ts`

2. **Extract component sub-modules**:
   - `active-filters-bar.tsx` → `FilterCategoryPopover`, `ActiveFilterTag`, etc.
   - `status-list.tsx` → `StatusListItem`, `StatusColorPicker`, etc.
   - `post-modal.tsx` → `PostModalHeader`, `PostModalSidebar`, etc.

3. **Consolidate query organization**:
   - Move all query key factories to `/lib/queries/`
   - Hooks in `/lib/hooks/` consume queries only
   - Separate query definitions from mutation definitions

4. **Type consolidation**:
   - Create `/lib/types/` directory
   - `post.types.ts` - All post-related types
   - `filters.types.ts` - All filter types
   - Remove duplicate definitions

5. **Shared component extraction**:
   - Expand `/components/shared/` with reusable primitives
   - `PostMetadata` - Used in both PostCard variants and modal
   - `FilterBar` - Abstract filter UI pattern
   - `VoteControl` - Vote button + count display

## Open Questions

- Should PostCard be split before or after tests are added?
- Is the full-page route (`feedback.posts.$postId.tsx`) still needed for any use case?
- What's the priority order for splitting post.service.ts domains?

## Next Steps

→ `/workflows:plan` to create implementation plan for highest-priority items
