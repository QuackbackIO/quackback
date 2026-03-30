# Post Board Change

Allow admins to move a post to a different board directly from the post detail modal, by clicking the Board field in the metadata sidebar to get a dropdown of available boards.

## Architecture

Mirrors the status-change pattern: dedicated domain function → server function → mutation hook → sidebar UI.

## Server Layer

**`ActivityType`** — add `'post.board_changed'` to the union in `activity.service.ts`.

**New domain function** `changeBoard` in `apps/web/src/lib/server/domains/posts/post.board.ts`:

- Signature: `changeBoard(postId, newBoardId, actor)`
- Fetches the post; throws `NOT_FOUND` if missing
- Fetches the new board; throws `NOT_FOUND` if missing
- Updates `posts.boardId`
- Fire-and-forget `createActivity` with type `'post.board_changed'`, metadata `{ fromBoardId, fromBoardName, toBoardId, toBoardName }`
- Returns the updated post row

**New server function** `changePostBoardFn` in `posts.ts`:

- Schema: `{ id: string, boardId: string }`
- Requires `admin` or `member` role
- Calls `changeBoard(id, boardId, actor)`

## Client Layer

**New mutation hook** `useChangePostBoard` in `mutations/posts.ts`:

- Calls `changePostBoardFn`
- `onSuccess`: invalidates `inboxKeys.detail(postId)` and `inboxKeys.lists()` (post may disappear from board-filtered views after moving)

**`MetadataSidebar` props additions:**

- `allBoards?: Array<{ id: string; name: string; slug: string }>`
- `onBoardChange?: (boardId: BoardId) => Promise<void>`

**`MetadataSidebar` board row behaviour:**

- When `canEdit && onBoardChange && allBoards.length > 0`: render the board value as a clickable Popover trigger listing all boards
- When not editable: keep existing static `<span>`
- No extracted `BoardDropdown` component — logic stays inline in `MetadataSidebar` (board change is only needed in this one place)

**`PostModal` additions:**

- `useQuery(adminQueries.boards())` — already cached across the app
- `handleBoardChange` calls `useChangePostBoard`, shows `toast.success('Board updated')`
- Passes `allBoards` and `onBoardChange` to `<MetadataSidebar>`

## UI Interaction

- Board row in admin sidebar becomes a clickable button with subtle hover state
- Popover lists all boards with `FolderIcon` and checkmark on the current board
- Selecting the current board: no-op, closes popover
- Selecting a different board: fires `onBoardChange`, closes popover, shows success toast
- Button is `disabled` while `isUpdating`

## Activity Timeline

Add `'post.board_changed'` case to `post-activity-timeline.tsx` displaying "Moved from _X_ to _Y_".
