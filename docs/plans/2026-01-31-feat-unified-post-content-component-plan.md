---
title: 'feat: Unified Post Content Component'
type: feat
date: 2026-01-31
brainstorm: docs/brainstorms/2026-01-31-unified-post-modal-brainstorm.md
deepened: 2026-01-31
reviewed: 2026-01-31
---

# feat: Unified Post Content Component

## Review Summary

**Reviewed on:** 2026-01-31
**Reviewers:** DHH Rails Reviewer, Kieran TypeScript Reviewer, Simplicity Reviewer

### Key Feedback Applied

1. **DHH**: "The cure is worse than the disease" - only 160 lines are duplicated, don't over-engineer
2. **Simplicity**: Inline URL state logic, no generic hooks, defer performance work
3. **Kieran**: Fix type issues if we keep discriminated unions (we're simplifying instead)

### Revised Approach

- **1 phase instead of 4**
- **2 new files instead of 6**
- **No generic hooks** - inline the 10 lines of URL state logic
- **No click-to-edit** - keep existing form pattern
- **No performance work** - defer until measured problems exist

---

## Overview

Add a modal overlay for viewing post details in the admin inbox, preserving scroll position and filter state. Extract shared form fields to reduce duplication between CreatePostDialog and EditPostDialog.

## Problem Statement

1. **Context switching**: Navigating to `/admin/feedback/posts/$postId` loses inbox scroll position and filter state
2. **Minor duplication**: ~160 lines of form JSX repeated between CreatePostDialog and EditPostDialog

## Proposed Solution (Simplified)

### Architecture

```
apps/web/src/components/admin/feedback/
├── post-form-fields.tsx          # NEW: Shared form JSX (~100 lines)
├── post-modal.tsx                # NEW: Modal wrapper with inline URL state
├── create-post-dialog.tsx        # SIMPLIFIED: Uses PostFormFields
├── edit-post-dialog.tsx          # SIMPLIFIED: Uses PostFormFields
└── inbox-container.tsx           # MODIFIED: Opens modal instead of navigating
```

**What we're NOT adding:**

- No `shared/post/` directory
- No `useUrlModal` hook
- No `useUnsavedChanges` hook
- No `useEditableField` hook
- No `EditableField` component
- No click-to-edit UX change
- No performance optimizations
- No portal changes

### Key Design Decisions

| Decision           | Choice                       | Rationale                           |
| ------------------ | ---------------------------- | ----------------------------------- |
| Admin post viewing | Modal overlay                | Preserves inbox context             |
| URL behavior       | `?post=post_abc` query param | Shareable, back button works        |
| Edit UX            | Keep existing form pattern   | Already works, no need to change    |
| Shared code        | Extract form fields only     | Minimal extraction, maximum clarity |

## Technical Approach

### PostFormFields Component

Extract the duplicated form JSX into a single component:

```typescript
// post-form-fields.tsx (~100 lines)
interface PostFormFieldsProps {
  form: UseFormReturn<PostFormValues>
  boards: Board[]
  statuses: PostStatusEntity[]
  tags: Tag[]
  contentJson: JSONContent | null
  onContentChange: (json: JSONContent) => void
  error?: string
}

export function PostFormFields({
  form,
  boards,
  statuses,
  tags,
  contentJson,
  onContentChange,
  error,
}: PostFormFieldsProps) {
  return (
    <>
      {/* Header: Board + Status selectors */}
      <div className="flex items-center gap-4 pt-3 px-4 sm:px-6">
        <BoardSelector form={form} boards={boards} />
        <StatusSelector form={form} statuses={statuses} />
      </div>

      {/* Body: Title, Editor, Tags */}
      <div className="px-4 sm:px-6 py-4 space-y-2">
        {error && <ErrorAlert message={error} />}
        <TitleInput form={form} />
        <RichTextEditor
          value={contentJson || ''}
          onChange={onContentChange}
          borderless
          toolbarPosition="bottom"
        />
        <TagBadges form={form} tags={tags} />
      </div>
    </>
  )
}
```

### PostModal Component

Modal with inline URL state (no generic hook):

```typescript
// post-modal.tsx (~150 lines)
export function PostModal() {
  const search = useSearch({ from: '/admin/feedback' })
  const navigate = useNavigate()
  const postId = search.post as PostId | undefined

  const isOpen = !!postId
  const { data: post } = useSuspenseQuery(adminQueries.postDetail(postId!))

  // Inline URL state management - no hook needed
  const close = () => {
    navigate({
      search: (prev) => {
        const { post, ...rest } = prev
        return rest
      },
      replace: true,
    })
  }

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }
      if (e.key === 'Escape') close()
      // j/k navigation uses existing sessionStorage context
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && close()}>
      <DialogContent className="max-w-3xl">
        {post && <PostDetailContent post={post} />}
      </DialogContent>
    </Dialog>
  )
}
```

### Route Changes

Add `post` to search params validation:

```typescript
// routes/admin/feedback.tsx
const searchSchema = z.object({
  // ... existing params
  post: z.string().optional(), // NEW: Post ID for modal
})
```

## Acceptance Criteria

- [x] Modal opens from inbox list click
- [x] URL updates to `?post=post_abc123`
- [x] Back button/Escape closes modal
- [x] Scroll position preserved when modal closes
- [x] CreatePostDialog uses PostFormFields
- [x] EditPostDialog uses PostFormFields
- [ ] No regressions in existing functionality (needs manual testing)

## Implementation

### Files to Create (2)

1. `apps/web/src/components/admin/feedback/post-form-fields.tsx`
   - Extract form JSX from both dialogs
   - ~100 lines

2. `apps/web/src/components/admin/feedback/post-modal.tsx`
   - Modal wrapper with inline URL state
   - Reuses existing detail components
   - ~150 lines

### Files to Modify (3)

1. `apps/web/src/components/admin/feedback/create-post-dialog.tsx`
   - Replace form JSX with `<PostFormFields />`
   - Keep SimilarPostsCard, footer, mutation logic

2. `apps/web/src/components/admin/feedback/edit-post-dialog.tsx`
   - Replace form JSX with `<PostFormFields />`
   - Keep form reset logic, mutations

3. `apps/web/src/routes/admin/feedback.tsx`
   - Add `post` to search schema
   - Render `<PostModal />` in layout

### Files to Modify (1)

4. `apps/web/src/components/admin/feedback/inbox-container.tsx`
   - Change row click to update URL instead of navigate

## What We're NOT Doing

Per reviewer feedback, these are explicitly out of scope:

| Deferred Item                    | Reason                                     |
| -------------------------------- | ------------------------------------------ |
| Generic `useUrlModal` hook       | Only one use case; inline is simpler       |
| Generic `useUnsavedChanges` hook | react-hook-form's `isDirty` already exists |
| Click-to-edit UX                 | New pattern not needed for consolidation   |
| Portal changes                   | Portal already works fine                  |
| Performance optimization         | No measured problems exist                 |
| Discriminated union types        | Simple props are clearer                   |

## Success Metrics

- **Code reduction**: ~160 lines of duplication → shared `PostFormFields`
- **Context preservation**: Admin users stay in inbox while viewing posts
- **Simplicity**: 2 new files, ~250 total new lines

## References

- Brainstorm: `docs/brainstorms/2026-01-31-unified-post-modal-brainstorm.md`
- CreatePostDialog: `apps/web/src/components/admin/feedback/create-post-dialog.tsx`
- EditPostDialog: `apps/web/src/components/admin/feedback/edit-post-dialog.tsx`
- Existing search schema: `apps/web/src/routes/admin/feedback.tsx`
