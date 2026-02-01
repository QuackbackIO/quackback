---
title: Delete Duplicate Post Detail Route
type: refactor
date: 2026-02-01
---

# Delete Duplicate Post Detail Route

## Overview

Remove the redundant full-page post detail route (`feedback.posts.$postId.tsx`) since the modal-based approach (`post-modal.tsx`) now handles all post detail functionality in the admin inbox.

## Problem Statement

Two implementations of the admin post detail view exist:

| Implementation        | Location                                   | Lines | Approach                                     |
| --------------------- | ------------------------------------------ | ----- | -------------------------------------------- |
| `PostModal`           | `components/admin/feedback/post-modal.tsx` | 528   | Modal via `?post=<id>` search param          |
| `FeedbackDetailRoute` | `routes/admin/feedback.posts.$postId.tsx`  | 512   | Full-page route `/admin/feedback/posts/<id>` |

Both files:

- Import the same public detail components (`PostContentSection`, `MetadataSidebar`, `CommentsSection`)
- Duplicate the same `toPortalPostView()` transformation function (lines 119-162 in route, 75-118 in modal)
- Use identical mutation hooks (`useUpdatePostStatus`, `useUpdatePostTags`, etc.)
- Implement the same keyboard navigation via `usePostDetailKeyboard`

The full-page route is orphaned—no external navigation points to it. It only references itself for prev/next navigation.

## Proposed Solution

Delete the full-page route file and let the modal handle all post detail viewing.

## Technical Approach

### Phase 1: Verification (Pre-deletion)

Confirm no external references exist:

```bash
# Search for any navigation to the full-page route
rg "feedback/posts/\$postId|feedback\.posts\.\$postId" --type tsx
```

Expected: Only self-references within `feedback.posts.$postId.tsx`

### Phase 2: Delete Route

Delete the file:

- `apps/web/src/routes/admin/feedback.posts.$postId.tsx` (512 lines)

### Phase 3: Regenerate Route Tree

TanStack Router auto-generates `routeTree.gen.ts`. After deletion:

```bash
bun run dev  # Triggers route regeneration
```

Verify the route tree no longer includes `feedback/posts/$postId`.

### Phase 4: Extract Shared Helper (Optional)

Both files duplicate `toPortalPostView()`. After deletion, only `post-modal.tsx` remains, so no extraction is needed now. But if this function is needed elsewhere later:

```typescript
// lib/transformations/post.ts
export function adminPostToPortalView(post: PostDetails): PublicPostDetailView
```

## Acceptance Criteria

- [x] `apps/web/src/routes/admin/feedback.posts.$postId.tsx` deleted
- [x] Route tree regenerated without errors
- [x] `bun run build` succeeds
- [x] `bun run typecheck` succeeds
- [ ] Admin inbox modal still opens posts correctly (`?post=<id>`)
- [ ] Keyboard navigation (j/k, Escape) works in modal

## Testing Requirements

### Manual Testing

1. Navigate to `/admin/feedback`
2. Click a post row → modal opens
3. Press `j` / `k` → navigates to next/prev post
4. Press `Escape` → modal closes
5. Refresh page with `?post=<id>` in URL → modal opens directly

### E2E Coverage

Existing test should cover this:

- `apps/web/e2e/tests/admin/post-management.spec.ts`

## Dependencies & Risks

**Low Risk:**

- No external navigation targets this route
- Modal already provides full feature parity
- Route tree regeneration is automatic

**Mitigation:**

- Run full grep before deletion to confirm no hidden references
- Run E2E tests after deletion

## References

- Brainstorm: `docs/brainstorms/2026-02-01-architecture-review-brainstorm.md`
- Duplicate route: `apps/web/src/routes/admin/feedback.posts.$postId.tsx:1-512`
- Modal implementation: `apps/web/src/components/admin/feedback/post-modal.tsx:1-528`
- Parent route using modal: `apps/web/src/routes/admin/feedback.tsx:53`
