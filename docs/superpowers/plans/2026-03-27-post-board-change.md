# Post Board Change Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow admins to move a post to a different board by clicking the Board field in the metadata sidebar.

**Architecture:** Mirrors the status-change pattern — dedicated domain function (`post.board.ts`) → server function in `posts.ts` → mutation hook → sidebar UI popover.

**Tech Stack:** Drizzle ORM, TanStack Query, TanStack Start server functions, Zod, Radix UI Popover (via shadcn), Heroicons, Vitest

---

## File Map

| Action | File                                                                       | Responsibility                          |
| ------ | -------------------------------------------------------------------------- | --------------------------------------- |
| Modify | `apps/web/src/lib/server/domains/activity/activity.service.ts`             | Add `'post.board_changed'` ActivityType |
| Create | `apps/web/src/lib/server/domains/posts/post.board.ts`                      | `changeBoard` domain function           |
| Create | `apps/web/src/lib/server/domains/posts/__tests__/post-board.test.ts`       | Unit tests for `changeBoard`            |
| Modify | `apps/web/src/lib/server/functions/posts.ts`                               | Add `changePostBoardFn` server function |
| Modify | `apps/web/src/lib/client/mutations/posts.ts`                               | Add `useChangePostBoard` mutation hook  |
| Modify | `apps/web/src/lib/client/mutations/index.ts`                               | Export `useChangePostBoard`             |
| Modify | `apps/web/src/components/public/post-detail/metadata-sidebar.tsx`          | Board row popover UI                    |
| Modify | `apps/web/src/components/admin/feedback/post-modal.tsx`                    | Fetch boards, wire handler              |
| Modify | `apps/web/src/components/admin/feedback/detail/post-activity-timeline.tsx` | Render `post.board_changed` entries     |

---

## Task 1: ActivityType + `changeBoard` domain function

**Files:**

- Modify: `apps/web/src/lib/server/domains/activity/activity.service.ts:16-38`
- Create: `apps/web/src/lib/server/domains/posts/post.board.ts`
- Create: `apps/web/src/lib/server/domains/posts/__tests__/post-board.test.ts`

- [ ] **Step 1: Add `'post.board_changed'` to ActivityType**

In `apps/web/src/lib/server/domains/activity/activity.service.ts`, add to the `ActivityType` union (after `'status.changed'`):

```typescript
export type ActivityType =
  | 'post.created'
  | 'post.deleted'
  | 'post.restored'
  | 'status.changed'
  | 'post.board_changed' // ← add this line
  | 'post.merged_in'
// ... rest unchanged
```

- [ ] **Step 2: Write failing tests for `changeBoard`**

Create `apps/web/src/lib/server/domains/posts/__tests__/post-board.test.ts`:

```typescript
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { PostId, BoardId, PrincipalId } from '@quackback/ids'

const createActivity = vi.fn()
const mockPostsFindFirst = vi.fn()
const mockBoardsFindFirst = vi.fn()

const updateReturning = vi.fn()
const updateWhere = vi.fn(() => ({ returning: updateReturning }))
const updateSet = vi.fn(() => ({ where: updateWhere }))
const dbUpdate = vi.fn(() => ({ set: updateSet }))

vi.mock('@/lib/server/db', async () => {
  return {
    db: {
      query: {
        posts: { findFirst: (...args: unknown[]) => mockPostsFindFirst(...args) },
        boards: { findFirst: (...args: unknown[]) => mockBoardsFindFirst(...args) },
      },
      update: dbUpdate,
    },
    boards: { id: 'board_id' },
    eq: vi.fn(),
    posts: { id: 'post_id' },
  }
})

vi.mock('@/lib/server/domains/activity/activity.service', () => ({
  createActivity,
}))

const actor = {
  principalId: 'principal_abc' as PrincipalId,
  email: 'admin@example.com',
  displayName: 'Admin',
}

describe('changeBoard', () => {
  beforeEach(() => {
    createActivity.mockClear()
    mockPostsFindFirst.mockReset()
    mockBoardsFindFirst.mockReset()
    updateReturning.mockReset()
  })

  it('throws POST_NOT_FOUND when post does not exist', async () => {
    mockPostsFindFirst.mockResolvedValue(null)
    const { changeBoard } = await import('../post.board')
    await expect(changeBoard('post_999' as PostId, 'board_new' as BoardId, actor)).rejects.toThrow(
      'Post with ID post_999 not found'
    )
  })

  it('throws BOARD_NOT_FOUND when current board does not exist', async () => {
    mockPostsFindFirst.mockResolvedValue({ id: 'post_123', boardId: 'board_old' })
    mockBoardsFindFirst
      .mockResolvedValueOnce(null) // currentBoard
      .mockResolvedValueOnce({ id: 'board_new', name: 'New Board', slug: 'new' })
    const { changeBoard } = await import('../post.board')
    await expect(changeBoard('post_123' as PostId, 'board_new' as BoardId, actor)).rejects.toThrow(
      'Board with ID board_old not found'
    )
  })

  it('throws BOARD_NOT_FOUND when new board does not exist', async () => {
    mockPostsFindFirst.mockResolvedValue({ id: 'post_123', boardId: 'board_old' })
    mockBoardsFindFirst
      .mockResolvedValueOnce({ id: 'board_old', name: 'Old Board', slug: 'old' })
      .mockResolvedValueOnce(null) // newBoard
    const { changeBoard } = await import('../post.board')
    await expect(changeBoard('post_123' as PostId, 'board_new' as BoardId, actor)).rejects.toThrow(
      'Board with ID board_new not found'
    )
  })

  it('updates boardId and returns updated post', async () => {
    const updatedPost = { id: 'post_123', boardId: 'board_new', title: 'Test' }
    mockPostsFindFirst.mockResolvedValue({ id: 'post_123', boardId: 'board_old' })
    mockBoardsFindFirst
      .mockResolvedValueOnce({ id: 'board_old', name: 'Old Board', slug: 'old' })
      .mockResolvedValueOnce({ id: 'board_new', name: 'New Board', slug: 'new' })
    updateReturning.mockResolvedValue([updatedPost])
    const { changeBoard } = await import('../post.board')
    const result = await changeBoard('post_123' as PostId, 'board_new' as BoardId, actor)
    expect(result).toEqual(updatedPost)
  })

  it('creates a post.board_changed activity with from/to board names', async () => {
    const updatedPost = { id: 'post_123', boardId: 'board_new' }
    mockPostsFindFirst.mockResolvedValue({ id: 'post_123', boardId: 'board_old' })
    mockBoardsFindFirst
      .mockResolvedValueOnce({ id: 'board_old', name: 'Old Board', slug: 'old' })
      .mockResolvedValueOnce({ id: 'board_new', name: 'New Board', slug: 'new' })
    updateReturning.mockResolvedValue([updatedPost])
    const { changeBoard } = await import('../post.board')
    await changeBoard('post_123' as PostId, 'board_new' as BoardId, actor)
    expect(createActivity).toHaveBeenCalledWith({
      postId: 'post_123',
      principalId: actor.principalId,
      type: 'post.board_changed',
      metadata: {
        fromBoardId: 'board_old',
        fromBoardName: 'Old Board',
        toBoardId: 'board_new',
        toBoardName: 'New Board',
      },
    })
  })

  it('does not call createActivity when DB update returns empty', async () => {
    mockPostsFindFirst.mockResolvedValue({ id: 'post_123', boardId: 'board_old' })
    mockBoardsFindFirst
      .mockResolvedValueOnce({ id: 'board_old', name: 'Old Board', slug: 'old' })
      .mockResolvedValueOnce({ id: 'board_new', name: 'New Board', slug: 'new' })
    updateReturning.mockResolvedValue([])
    const { changeBoard } = await import('../post.board')
    await expect(changeBoard('post_123' as PostId, 'board_new' as BoardId, actor)).rejects.toThrow(
      'Post with ID post_123 not found'
    )
    expect(createActivity).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 3: Run tests to confirm they fail**

```bash
cd apps/web && bun run test src/lib/server/domains/posts/__tests__/post-board.test.ts
```

Expected: all tests fail with `Cannot find module '../post.board'`

- [ ] **Step 4: Create `post.board.ts`**

Create `apps/web/src/lib/server/domains/posts/post.board.ts`:

```typescript
/**
 * Post Board Service
 *
 * Handles moving a post from one board to another.
 */

import { db, posts, boards, eq } from '@/lib/server/db'
import { type PostId, type BoardId, type UserId, type PrincipalId } from '@quackback/ids'
import { NotFoundError } from '@/lib/shared/errors'
import { createActivity } from '@/lib/server/domains/activity/activity.service'

/**
 * Move a post to a different board.
 *
 * Note: Authorization is handled at the action layer before calling this function.
 */
export async function changeBoard(
  postId: PostId,
  newBoardId: BoardId,
  actor: {
    principalId: PrincipalId
    userId?: UserId
    email?: string
    displayName?: string
  }
) {
  const existingPost = await db.query.posts.findFirst({ where: eq(posts.id, postId) })
  if (!existingPost) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  const [currentBoard, newBoard] = await Promise.all([
    db.query.boards.findFirst({ where: eq(boards.id, existingPost.boardId) }),
    db.query.boards.findFirst({ where: eq(boards.id, newBoardId) }),
  ])

  if (!currentBoard) {
    throw new NotFoundError('BOARD_NOT_FOUND', `Board with ID ${existingPost.boardId} not found`)
  }
  if (!newBoard) {
    throw new NotFoundError('BOARD_NOT_FOUND', `Board with ID ${newBoardId} not found`)
  }

  const [updatedPost] = await db
    .update(posts)
    .set({ boardId: newBoardId })
    .where(eq(posts.id, postId))
    .returning()

  if (!updatedPost) {
    throw new NotFoundError('POST_NOT_FOUND', `Post with ID ${postId} not found`)
  }

  createActivity({
    postId,
    principalId: actor.principalId,
    type: 'post.board_changed',
    metadata: {
      fromBoardId: currentBoard.id,
      fromBoardName: currentBoard.name,
      toBoardId: newBoard.id,
      toBoardName: newBoard.name,
    },
  })

  return updatedPost
}
```

- [ ] **Step 5: Run tests — all should pass**

```bash
cd apps/web && bun run test src/lib/server/domains/posts/__tests__/post-board.test.ts
```

Expected: 5 tests pass

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/server/domains/activity/activity.service.ts \
        apps/web/src/lib/server/domains/posts/post.board.ts \
        apps/web/src/lib/server/domains/posts/__tests__/post-board.test.ts
git commit -m "feat: add changeBoard domain function with post.board_changed activity"
```

---

## Task 2: Server function `changePostBoardFn`

**Files:**

- Modify: `apps/web/src/lib/server/functions/posts.ts`

- [ ] **Step 1: Add schema and function**

In `apps/web/src/lib/server/functions/posts.ts`:

1. Add the import for `changeBoard` near the top where other domain imports live:

```typescript
import { changeBoard } from '@/lib/server/domains/posts/post.board'
```

2. Add `BoardId` to the `@quackback/ids` import if not already there:

```typescript
import type { PostId, StatusId, TagId, BoardId, UserId, PrincipalId } from '@quackback/ids'
```

(Check the existing import — it likely already has `UserId` and `PrincipalId`; add `BoardId` if missing.)

3. Add schema and server function after the existing `changeStatusSchema` block (~line 121):

```typescript
const changePostBoardSchema = z.object({
  id: z.string(),
  boardId: z.string(),
})
```

4. Add the server function after `changePostStatusFn` (search for that function, place this after it):

```typescript
/**
 * Move a post to a different board
 */
export const changePostBoardFn = createServerFn({ method: 'POST' })
  .inputValidator(changePostBoardSchema)
  .handler(async ({ data }) => {
    console.log(`[fn:posts] changePostBoardFn: id=${data.id}, boardId=${data.boardId}`)
    try {
      const auth = await requireAuth({ roles: ['admin', 'member'] })
      return await changeBoard(data.id as PostId, data.boardId as BoardId, {
        principalId: auth.principal.id as PrincipalId,
        userId: auth.user.id as UserId,
        email: auth.user.email,
        displayName: auth.user.name,
      })
    } catch (error) {
      console.error(`[fn:posts] ❌ changePostBoardFn failed:`, error)
      throw error
    }
  })
```

- [ ] **Step 2: Type-check**

```bash
cd apps/web && bun run typecheck 2>&1 | grep -i "post.board\|changePostBoard\|changeBoard"
```

Expected: no errors related to these files

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/server/functions/posts.ts
git commit -m "feat: add changePostBoardFn server function"
```

---

## Task 3: Client mutation hook

**Files:**

- Modify: `apps/web/src/lib/client/mutations/posts.ts`
- Modify: `apps/web/src/lib/client/mutations/index.ts`

- [ ] **Step 1: Add `useChangePostBoard` to `mutations/posts.ts`**

Add the following import near the top of `mutations/posts.ts` (alongside the other server function imports):

```typescript
import { changePostBoardFn } from '@/lib/server/functions/posts'
```

Add `BoardId` to the `@quackback/ids` import in this file.

Add the hook after `useChangePostStatusId` (around line 130):

```typescript
// ============================================================================
// Board Mutations
// ============================================================================

export function useChangePostBoard() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ postId, boardId }: { postId: PostId; boardId: BoardId }) =>
      changePostBoardFn({ data: { id: postId, boardId } }),
    onSuccess: (_data, { postId }) => {
      queryClient.invalidateQueries({ queryKey: inboxKeys.detail(postId) })
      queryClient.invalidateQueries({ queryKey: inboxKeys.lists() })
    },
  })
}
```

- [ ] **Step 2: Export from barrel `mutations/index.ts`**

Add to the admin post mutations block in `apps/web/src/lib/client/mutations/index.ts`:

```typescript
export {
  useUpdatePostStatus,
  useChangePostStatusId,
  useUpdatePostOwner,
  useUpdatePostTags,
  useUpdatePost,
  useVotePost,
  useCreatePost,
  useDeletePost,
  useRestorePost,
  useToggleCommentsLock,
  useChangePostBoard, // ← add this
} from './posts'
```

- [ ] **Step 3: Type-check**

```bash
cd apps/web && bun run typecheck 2>&1 | grep -i "mutations/posts\|useChangePostBoard"
```

Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/lib/client/mutations/posts.ts \
        apps/web/src/lib/client/mutations/index.ts
git commit -m "feat: add useChangePostBoard mutation hook"
```

---

## Task 4: MetadataSidebar board dropdown UI

**Files:**

- Modify: `apps/web/src/components/public/post-detail/metadata-sidebar.tsx`

- [ ] **Step 1: Update imports**

In `metadata-sidebar.tsx`, the `board` prop currently types as `{ name: string; slug: string }`. The query result already includes `id` — update the type. Also add `CheckIcon` and `BoardId`:

1. Add `CheckIcon` import from solid (alongside ChevronUpIcon which is already from solid):

```typescript
import { CheckIcon } from '@heroicons/react/24/solid'
```

(The file currently imports `ChevronUpIcon` from `@heroicons/react/24/solid` — add `CheckIcon` to that same import.)

Wait — check the file's current imports. The file imports from `@heroicons/react/24/outline` only. Add a new import:

```typescript
import { CheckIcon } from '@heroicons/react/24/solid'
```

2. Add `BoardId` to the `@quackback/ids` import (it currently imports `PostId, StatusId, TagId, RoadmapId`):

```typescript
import type { PostId, StatusId, TagId, RoadmapId, BoardId } from '@quackback/ids'
```

- [ ] **Step 2: Update `board` prop type and add new props**

In the `MetadataSidebarProps` interface, update the `board` field and add two new optional props:

```typescript
// Change from:
board: { name: string; slug: string }
// To:
board: { id: string; name: string; slug: string }

// Add after the existing admin mode props (after onRoadmapRemove):
/** All available boards for selection */
allBoards?: Array<{ id: string; name: string; slug: string }>
/** Callback when board changes */
onBoardChange?: (boardId: BoardId) => Promise<void>
```

- [ ] **Step 3: Add `boardOpen` state and `handleBoardChange` handler**

In the function body of `MetadataSidebar`, add alongside the existing `tagOpen`/`roadmapOpen` state:

```typescript
const [boardOpen, setBoardOpen] = useState(false)
```

Add a handler alongside `handleAddTag` etc.:

```typescript
async function handleBoardChange(boardId: BoardId) {
  if (!onBoardChange || boardId === (board.id as BoardId)) {
    setBoardOpen(false)
    return
  }
  setBoardOpen(false)
  await onBoardChange(boardId)
}
```

- [ ] **Step 4: Update the Board row JSX**

Find the Board section (~line 423):

```tsx
{
  /* Board */
}
;<div className="flex items-center justify-between">
  <div className="flex items-center gap-2 text-sm text-muted-foreground">
    <FolderIcon className="h-4 w-4" />
    <span>Board</span>
  </div>
  <span className="text-sm font-medium text-foreground">{board.name}</span>
</div>
```

Replace with:

```tsx
{
  /* Board */
}
;<div className="flex items-center justify-between">
  <div className="flex items-center gap-2 text-sm text-muted-foreground">
    <FolderIcon className="h-4 w-4" />
    <span>Board</span>
  </div>
  {canEdit && onBoardChange && allBoards && allBoards.length > 0 ? (
    <Popover open={boardOpen} onOpenChange={setBoardOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={isUpdating}
          className={cn(
            'text-sm font-medium text-foreground',
            'hover:text-primary transition-colors',
            'disabled:opacity-50 disabled:cursor-not-allowed'
          )}
        >
          {board.name}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-1" align="end" sideOffset={4}>
        <div className="max-h-48 overflow-y-auto space-y-0.5">
          {allBoards.map((b) => (
            <button
              key={b.id}
              type="button"
              onClick={() => handleBoardChange(b.id as BoardId)}
              className={cn(
                'w-full flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-md',
                'text-foreground/80 hover:text-foreground hover:bg-muted/60',
                'transition-all duration-100 text-left font-medium'
              )}
            >
              <FolderIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="truncate flex-1">{b.name}</span>
              {b.id === board.id && <CheckIcon className="h-3.5 w-3.5 text-primary shrink-0" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  ) : (
    <span className="text-sm font-medium text-foreground">{board.name}</span>
  )}
</div>
```

- [ ] **Step 5: Type-check**

```bash
cd apps/web && bun run typecheck 2>&1 | grep -i "metadata-sidebar"
```

Expected: no errors

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/public/post-detail/metadata-sidebar.tsx
git commit -m "feat: add board change popover to MetadataSidebar"
```

---

## Task 5: Wire board change in `PostModal`

**Files:**

- Modify: `apps/web/src/components/admin/feedback/post-modal.tsx`

- [ ] **Step 1: Add boards query and mutation**

In `post-modal.tsx`, in the `PostModalContent` component:

1. Add `useChangePostBoard` to the mutations import:

```typescript
import {
  useUpdatePost,
  useUpdatePostStatus,
  useUpdatePostTags,
  usePinComment,
  useUnpinComment,
  useToggleCommentsLock,
  useDeletePost,
  useRestorePost,
  useChangePostBoard, // ← add
} from '@/lib/client/mutations'
```

2. Add `BoardId` to the `@quackback/ids` import:

```typescript
import {
  type PostId,
  type StatusId,
  type TagId,
  type RoadmapId,
  type CommentId,
  type BoardId, // ← add
} from '@quackback/ids'
```

3. Add the boards query alongside the existing queries (after `roadmaps` query):

```typescript
const { data: boards = [] } = useQuery(adminQueries.boards())
```

Note: `adminQueries` already exists in scope; `boards()` is already defined there and the data is cached app-wide.

4. Add the mutation alongside the existing mutations:

```typescript
const changePostBoard = useChangePostBoard()
```

- [ ] **Step 2: Add `handleBoardChange` handler**

Add alongside `handleStatusChange` and `handleTagsChange`:

```typescript
const handleBoardChange = async (boardId: BoardId) => {
  setIsUpdating(true)
  try {
    await changePostBoard.mutateAsync({ postId: post.id as PostId, boardId })
    toast.success('Board updated')
  } catch (err) {
    toast.error(err instanceof Error ? err.message : 'Failed to update board')
  } finally {
    setIsUpdating(false)
  }
}
```

- [ ] **Step 3: Pass `allBoards` and `onBoardChange` to MetadataSidebar**

Find the `<MetadataSidebar ...>` JSX block (~line 451). It currently receives `allStatuses`, `allTags`, `allRoadmaps` etc. Add the two new props:

```tsx
<MetadataSidebar
  postId={postId}
  voteCount={post.voteCount}
  status={currentStatus}
  board={post.board}
  authorName={post.authorName}
  authorAvatarUrl={(post.principalId && post.avatarUrls?.[post.principalId]) || null}
  authorPrincipalId={post.principalId}
  createdAt={new Date(post.createdAt)}
  tags={post.tags}
  roadmaps={postRoadmaps}
  canEdit
  allStatuses={statuses}
  allTags={tags}
  allRoadmaps={roadmaps}
  allBoards={boards} // ← add
  onStatusChange={handleStatusChange}
  onTagsChange={handleTagsChange}
  onRoadmapAdd={handleRoadmapAdd}
  onRoadmapRemove={handleRoadmapRemove}
  onBoardChange={handleBoardChange} // ← add
  isUpdating={isUpdating || !!pendingRoadmapId}
  hideSubscribe
  variant="card"
  manageActions={manageActions}
  feedbackSource={feedbackSource}
/>
```

- [ ] **Step 4: Type-check**

```bash
cd apps/web && bun run typecheck 2>&1 | grep -i "post-modal"
```

Expected: no errors

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/admin/feedback/post-modal.tsx
git commit -m "feat: wire board change in PostModal"
```

---

## Task 6: Activity timeline rendering

**Files:**

- Modify: `apps/web/src/components/admin/feedback/detail/post-activity-timeline.tsx`

- [ ] **Step 1: Add `FolderIcon` import**

The file currently imports from `@heroicons/react/16/solid`. Add `FolderIcon` to that import:

```typescript
import {
  PlusIcon,
  TrashIcon,
  ArrowUturnLeftIcon,
  UserIcon,
  TagIcon,
  MapIcon,
  LockClosedIcon,
  LockOpenIcon,
  ChatBubbleLeftIcon,
  HandThumbUpIcon,
  FolderIcon, // ← add
} from '@heroicons/react/16/solid'
```

- [ ] **Step 2: Add `'post.board_changed'` to `ACTIVITY_CONFIG`**

Find the `ACTIVITY_CONFIG` object in the file. Add a new entry after `'status.changed'`:

```typescript
'post.board_changed': {
  icon: FolderIcon,
  label: (_, a) => `${actorLabel(a)} moved to a different board`,
  detail: (m) => {
    const from = m.fromBoardName as string | undefined
    const to = m.toBoardName as string | undefined
    if (!from && !to) return null
    return (
      <span className="text-xs text-muted-foreground">
        {from} &rarr; {to}
      </span>
    )
  },
},
```

- [ ] **Step 3: Type-check and run full test suite**

```bash
cd apps/web && bun run typecheck
bun run test
```

Expected: no type errors, all tests pass

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/admin/feedback/detail/post-activity-timeline.tsx
git commit -m "feat: render post.board_changed in activity timeline"
```

---

## Verification

After all tasks are complete, manually verify in the running app:

1. Open a post in the admin inbox (`bun run dev`, login `demo@example.com` / `password`)
2. Click the board name in the metadata sidebar — a popover with all boards should appear, checkmark on the current board
3. Select a different board — the board name updates, toast shows "Board updated"
4. Open the Activity tab — a "moved to a different board" entry shows with from/to names
5. Close and reopen the post — board name reflects the new board
6. Check the inbox list — if filtered by the old board, the post should no longer appear
