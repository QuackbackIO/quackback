---
title: 'feat: Admin Roadmap Modal Navigation'
type: feat
date: 2026-02-02
---

# feat: Admin Roadmap Modal Navigation

## Overview

Add modal-based post viewing to the admin roadmap. Clicking a roadmap card opens the post detail in a modal overlay, preserving roadmap context and scroll position. Consistent with admin changelog pattern.

## Problem Statement

Admin roadmap cards currently have no click action (only drag). Admins cannot quickly view post details without leaving the roadmap view.

## Proposed Solution

Add modal navigation to admin roadmap following the existing changelog modal pattern. **Keep all existing components unchanged** - this is purely additive.

### What We're Doing

- Add `?post=` URL param to admin roadmap route
- Add modal component that reuses existing `PostModalContent`
- Add drag handle to cards so click and drag are distinct actions

### What We're NOT Doing

- No portal changes (portal Link navigation to full page is fine)
- No component consolidation
- No shared roadmap components

## Technical Approach

### Phase 1: Admin Roadmap Modal

**Add search param to route:**

```typescript
// routes/admin/roadmap.tsx
const searchSchema = z.object({
  roadmap: z.string().optional(),
  post: z.string().optional(),  // NEW
})

function RoadmapPage() {
  const search = Route.useSearch()
  // ... existing code ...

  return (
    <main className="h-full">
      <RoadmapAdmin statuses={roadmapStatusesQuery.data} />
      <RoadmapModal postId={search.post} />  {/* NEW */}
    </main>
  )
}
```

**Create modal component:**

```typescript
// components/admin/roadmap-modal.tsx (~60 lines)
// Copy pattern from changelog-modal.tsx

export function RoadmapModal({ postId }: { postId: string | undefined }) {
  const navigate = useNavigate({ from: Route.fullPath })
  const search = Route.useSearch()

  const [localPostId, setLocalPostId] = useState(postId)
  const isOpen = !!localPostId

  useEffect(() => setLocalPostId(postId), [postId])

  const close = useCallback(() => {
    setLocalPostId(undefined)
    startTransition(() => {
      const { post: _, ...rest } = search
      navigate({ to: '/admin/roadmap', search: rest, replace: true })
    })
  }, [navigate, search])

  let validatedPostId: PostId | null = null
  if (localPostId) {
    try { validatedPostId = ensureTypeId(localPostId, 'post') } catch {}
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent className="w-[95vw] sm:w-[90vw] lg:max-w-5xl xl:max-w-6xl h-[85vh] p-0">
        <DialogTitle className="sr-only">View post</DialogTitle>
        {validatedPostId && (
          <Suspense fallback={<Loader />}>
            <PostModalContent postId={validatedPostId} onClose={close} />
          </Suspense>
        )}
      </DialogContent>
    </Dialog>
  )
}
```

**Update card with drag handle pattern:**

Use drag handle pattern (matches existing `status-list.tsx`) so click and drag are distinct:

```typescript
// components/admin/roadmap-card.tsx
interface RoadmapCardProps {
  post: RoadmapPostEntry
  statusId: string
  onClick?: () => void  // NEW
}

export const RoadmapCard = memo(function RoadmapCard({ post, statusId, onClick }: RoadmapCardProps) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: post.id,
    data: { type: 'Task', post, statusId },
  })

  return (
    <div
      ref={setNodeRef}
      onClick={onClick}
      style={{ opacity: isDragging ? 0.4 : 1 }}
      className="flex bg-card rounded-lg border shadow-sm cursor-pointer hover:bg-card/80 transition"
    >
      {/* Drag handle - only this area initiates drag */}
      <button
        type="button"
        {...attributes}
        {...listeners}
        onClick={(e) => e.stopPropagation()}  // Prevent click when dragging
        className="flex items-center justify-center w-8 shrink-0 border-r border-border/50 cursor-grab active:cursor-grabbing touch-none hover:bg-muted/50"
      >
        <Bars3Icon className="h-4 w-4 text-muted-foreground" />
      </button>
      <CardContent post={post} />
    </div>
  )
})
```

**Update column to pass click handler:**

```typescript
// components/admin/roadmap-column.tsx
interface RoadmapColumnProps {
  // ... existing props
  onCardClick?: (postId: string) => void  // NEW
}

// Pass to cards
<RoadmapCard
  post={post}
  statusId={statusId}
  onClick={onCardClick ? () => onCardClick(post.id) : undefined}
/>
```

**Update admin container to handle card clicks:**

```typescript
// components/admin/roadmap-admin.tsx
const navigate = useNavigate({ from: Route.fullPath })
const search = Route.useSearch()

const handleCardClick = (postId: string) => {
  navigate({ search: { ...search, post: postId } })
}

// In render, pass to columns:
<RoadmapColumn
  ...
  onCardClick={handleCardClick}
/>
```

## Acceptance Criteria

- [x] Clicking roadmap card opens post detail modal
- [x] Drag handle initiates drag (not entire card)
- [x] Click does NOT fire after completing a drag
- [x] URL updates to `?post=post_abc123`
- [x] Back button/Escape closes modal
- [x] Direct URL with `?post=` opens modal on load
- [x] Drag-and-drop still works for status changes

## Implementation Summary

### Files to Create (1)

| File                                 | Lines | Purpose                                   |
| ------------------------------------ | ----- | ----------------------------------------- |
| `components/admin/roadmap-modal.tsx` | ~60   | Modal wrapper following changelog pattern |

### Files to Modify (4)

| File                                  | Changes                                     |
| ------------------------------------- | ------------------------------------------- |
| `routes/admin/roadmap.tsx`            | Add `post` to search schema, render modal   |
| `components/admin/roadmap-admin.tsx`  | Add navigate, pass click handler to columns |
| `components/admin/roadmap-column.tsx` | Accept and pass `onCardClick` prop          |
| `components/admin/roadmap-card.tsx`   | Add drag handle, accept `onClick` prop      |

### No Files Deleted

Existing components remain unchanged in structure.

## Success Metrics

- Modal navigation works on admin roadmap
- Drag-and-drop unaffected (uses drag handle)
- URLs are shareable
- ~80 new lines total

## References

- Modal pattern: `components/admin/changelog/changelog-modal.tsx`
- Post modal content: `components/admin/feedback/post-modal.tsx`
- Drag handle pattern: `components/admin/settings/statuses/status-list.tsx`
