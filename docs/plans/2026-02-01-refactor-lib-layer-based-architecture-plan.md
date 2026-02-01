---
title: Refactor lib/ to Layer-Based Architecture
type: refactor
date: 2026-02-01
---

# Refactor lib/ to Layer-Based Architecture

## Overview

Reorganize `apps/web/src/lib/` from its current organic structure into a clear layer-based architecture that enforces separation of concerns and prevents concept mixing.

## Problem Statement

The current `lib/` directory has grown organically with several structural issues:

| Issue                        | Impact                                                                            |
| ---------------------------- | --------------------------------------------------------------------------------- |
| **Concept mixing in hooks/** | 40 files (5,377 lines) mixing React Query hooks, event handlers, and custom hooks |
| **Scattered types**          | 16 type files across different directories, no central location                   |
| **Reverse imports**          | 3 files in lib/ import from components/ (wrong direction)                         |
| **Monolithic services**      | `post.service.ts` is 1,439 lines handling 5+ domains                              |
| **Mega hooks**               | `use-inbox-queries.ts` (695 lines), `use-public-posts-query.ts` (500 lines)       |

**Root cause**: No clear conventions for where code belongs. New developers can't easily determine correct placement.

## Proposed Solution

Reorganize into explicit layers with clear responsibilities:

```
lib/
├── types/              # Domain type definitions (NEW)
├── services/           # Business logic (rename from feature dirs)
├── server-functions/   # TanStack RPC layer (keep, improve)
├── queries/            # Query key factories (keep, expand)
├── mutations/          # Mutation definitions (NEW - extract from hooks)
├── hooks/              # Pure React hooks only (slim down)
├── events/             # Event handlers (extract from hooks)
├── stores/             # Zustand stores (keep)
└── core/               # Infrastructure (db, auth, tenant)
```

## Technical Approach

### Phase 1: Create `lib/types/` and Fix Import Direction

**Goal**: Centralize shared types, fix reverse imports from components.

**Tasks**:

1. Create `lib/types/` directory structure:

   ```
   lib/types/
   ├── index.ts           # Re-exports all types
   ├── filters.ts         # InboxFilters, PublicFeedbackFilters, UsersFilters
   ├── posts.ts           # Re-export from posts/post.types.ts
   ├── comments.ts        # Re-export from comments/comment.types.ts
   └── common.ts          # Shared pagination, sorting types
   ```

2. Move filter types from components to lib:
   - `components/admin/feedback/use-inbox-filters.ts` → extract `InboxFilters` type
   - `components/public/feedback/use-public-filters.ts` → extract `PublicFeedbackFilters` type
   - `components/admin/users/use-users-filters.ts` → extract `UsersFilters` type
   - `components/admin/feedback/inbox-types.ts` → move to `lib/types/inbox.ts`

3. Update imports in 3 affected files:
   - `lib/hooks/use-inbox-queries.ts`
   - `lib/hooks/use-public-posts-query.ts`
   - `lib/hooks/use-users-queries.ts`

**Files to create**:

- `lib/types/index.ts`
- `lib/types/filters.ts`
- `lib/types/inbox.ts`

**Files to modify**:

- `lib/hooks/use-inbox-queries.ts` (update imports)
- `lib/hooks/use-public-posts-query.ts` (update imports)
- `lib/hooks/use-users-queries.ts` (update imports)
- `components/admin/feedback/use-inbox-filters.ts` (import from lib/types)
- `components/public/feedback/use-public-filters.ts` (import from lib/types)
- `components/admin/users/use-users-filters.ts` (import from lib/types)

**Acceptance criteria**:

- [x] No lib/ files import from components/
- [x] All filter types defined in lib/types/
- [x] Components import types from lib/types/
- [x] `bun run typecheck` passes
- [x] `bun run build` succeeds

---

### Phase 2: Extract Event Handlers from hooks/

**Goal**: Separate event handling (side effects) from React hooks (data fetching).

**Current state**: `lib/hooks/` contains event handlers that aren't React hooks:

- `webhook/handler.ts` (217 lines)
- `slack/handler.ts` (143 lines)
- `notification/handler.ts` (125 lines)
- `ai/handler.ts` (100 lines)
- `email/handler.ts` (54 lines)
- Plus supporting files (constants, message builders, oauth)

**Tasks**:

1. Create `lib/events/handlers/` directory:

   ```
   lib/events/
   ├── dispatch.ts        # (existing)
   ├── types.ts           # (existing)
   ├── handlers/          # (NEW)
   │   ├── index.ts
   │   ├── webhook.ts
   │   ├── slack.ts
   │   ├── notification.ts
   │   ├── ai.ts
   │   └── email.ts
   └── integrations/      # (NEW)
       ├── slack/
       │   ├── message.ts
       │   └── oauth.ts
       └── webhook/
           └── constants.ts
   ```

2. Move handler files from hooks/ to events/handlers/:
   - `hooks/webhook/handler.ts` → `events/handlers/webhook.ts`
   - `hooks/slack/handler.ts` → `events/handlers/slack.ts`
   - `hooks/notification/handler.ts` → `events/handlers/notification.ts`
   - `hooks/ai/handler.ts` → `events/handlers/ai.ts`
   - `hooks/email/handler.ts` → `events/handlers/email.ts`

3. Move integration utilities:
   - `hooks/webhook/constants.ts` → `events/integrations/webhook/constants.ts`
   - `hooks/slack/message.ts` → `events/integrations/slack/message.ts`
   - `hooks/slack/oauth.ts` → `events/integrations/slack/oauth.ts`

4. Update all imports referencing moved files

**Acceptance criteria**:

- [x] No event handlers remain in lib/hooks/
- [x] lib/hooks/ contains only React hooks
- [x] All imports updated
- [x] `bun run typecheck` passes

---

### Phase 3: Split Mega Hooks (Queries vs Mutations)

**Goal**: Separate query hooks from mutation hooks for clarity.

**Current mega files**:

- `use-inbox-queries.ts` (695 lines) - mixed queries + mutations
- `use-public-posts-query.ts` (500 lines) - mixed queries + mutations
- `use-comment-actions.ts` (377 lines) - all mutations

**Tasks**:

1. Create `lib/mutations/` directory:

   ```
   lib/mutations/
   ├── index.ts
   ├── posts.ts           # Post mutations (status, tags, create, delete)
   ├── comments.ts        # Comment mutations (add, edit, delete, pin)
   ├── votes.ts           # Vote mutations
   └── subscriptions.ts   # Subscription mutations
   ```

2. Split `use-inbox-queries.ts` (695 lines):
   - Keep in hooks/: `useInboxPosts`, `usePostDetail`, `inboxKeys`
   - Move to mutations/posts.ts: `useUpdatePostStatus`, `useUpdatePostTags`, `useCreatePost`
   - Move to mutations/comments.ts: comment mutations

3. Split `use-public-posts-query.ts` (500 lines):
   - Keep in hooks/: `usePublicPosts`, `usePublicPostDetail`, query keys
   - Move to mutations/: `usePublicVote`, `usePublicComment`

4. Rename hooks files for clarity:
   - `use-inbox-queries.ts` → `use-inbox-query.ts` (singular, queries only)
   - `use-public-posts-query.ts` → `use-portal-posts-query.ts`

**Target structure**:

```
lib/
├── hooks/
│   ├── use-inbox-query.ts        # ~200 lines (queries only)
│   ├── use-portal-posts-query.ts # ~150 lines (queries only)
│   ├── use-post-detail-keyboard.ts
│   └── ...other pure hooks
│
├── mutations/
│   ├── posts.ts                  # ~300 lines
│   ├── comments.ts               # ~200 lines
│   ├── votes.ts                  # ~100 lines
│   └── subscriptions.ts          # ~100 lines
```

**Acceptance criteria**:

- [x] No hook file exceeds 300 lines
- [x] hooks/ contains only query hooks and pure React hooks
- [x] mutations/ contains all mutation definitions
- [x] Consistent naming: `use-{feature}-query.ts` for queries
- [x] `bun run typecheck` passes

---

### Phase 4: Split post.service.ts (Domain Separation)

**Goal**: Break monolithic service into focused domain services.

**Current state**: `post.service.ts` (1,439 lines) handles:

- Lines 1-200: CRUD operations
- Lines 200-400: Voting
- Lines 400-700: Query building (listInboxPosts)
- Lines 700-900: Admin operations (status, tags, roadmaps)
- Lines 900-1439: Comments (should be in comment.service.ts)

**Tasks**:

1. Create focused service files:

   ```
   lib/posts/
   ├── post.service.ts      # CRUD only (~200 lines)
   ├── post.query.ts        # Query builders (~300 lines)
   ├── post.admin.ts        # Status/tag/roadmap ops (~200 lines)
   ├── post.voting.ts       # Vote operations (~200 lines)
   ├── post.types.ts        # (existing)
   └── index.ts             # Re-exports
   ```

2. Move comment operations to `lib/comments/comment.service.ts`

3. Update imports in server-functions/ that use post.service.ts

**Acceptance criteria**:

- [ ] No service file exceeds 400 lines
- [ ] Each file has single responsibility
- [ ] Comment operations live in comments/
- [ ] All imports updated
- [ ] `bun run typecheck` passes

---

### Phase 5: Establish `lib/core/` for Infrastructure

**Goal**: Group infrastructure code separately from business logic.

**Tasks**:

1. Create `lib/core/` directory:

   ```
   lib/core/
   ├── db.ts               # (move from lib/db.ts)
   ├── db-types.ts         # (move from lib/db-types.ts)
   ├── auth/               # (move from lib/auth/)
   ├── tenant/             # (move from lib/tenant/)
   └── config.ts           # App configuration
   ```

2. Update barrel exports in `lib/db.ts` to re-export from core/

3. Update CLAUDE.md to document new structure

**Acceptance criteria**:

- [ ] Infrastructure code in lib/core/
- [ ] Import paths still work via re-exports
- [ ] CLAUDE.md updated with new conventions

---

## Implementation Order

| Phase                     | Risk   | Effort | Value                         |
| ------------------------- | ------ | ------ | ----------------------------- |
| 1. Create lib/types/      | Low    | Small  | High - fixes import direction |
| 2. Extract event handlers | Low    | Medium | Medium - cleaner hooks/       |
| 3. Split mega hooks       | Medium | Medium | High - clarity                |
| 4. Split post.service.ts  | Medium | Large  | High - maintainability        |
| 5. Establish lib/core/    | Low    | Small  | Medium - organization         |

**Recommended**: Complete phases 1-3 first (can be done in one PR). Phases 4-5 can follow separately.

## Acceptance Criteria (Overall)

- [ ] No lib/ files import from components/
- [ ] No file in lib/hooks/ exceeds 300 lines
- [ ] No service file exceeds 400 lines
- [ ] Clear layer separation documented in CLAUDE.md
- [ ] All tests pass
- [ ] Build succeeds

## Testing Requirements

- `bun run typecheck` after each phase
- `bun run build` after each phase
- `bun run lint` before final commit
- Manual verification that admin inbox and portal still work

## Dependencies & Risks

**Low Risk**:

- Type movements are safe (compile-time only)
- Event handler moves are isolated
- Re-exports maintain backwards compatibility

**Medium Risk**:

- Splitting hooks may affect React Query cache keys
- Service splits need careful import updates

**Mitigation**:

- Incremental commits per phase
- Run typecheck frequently
- Keep re-exports for backwards compatibility initially

## References

- Brainstorm: `docs/brainstorms/2026-02-01-architecture-review-brainstorm.md`
- Current hooks: `apps/web/src/lib/hooks/` (40 files, 5,377 lines)
- Current post service: `apps/web/src/lib/posts/post.service.ts` (1,439 lines)
- Reverse imports: `use-inbox-queries.ts:18`, `use-public-posts-query.ts:18`, `use-users-queries.ts:8`
