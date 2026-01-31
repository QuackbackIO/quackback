---
title: 'refactor: Admin Inbox List UX Simplification'
type: refactor
date: 2026-01-31
brainstorm: docs/brainstorms/2026-01-31-admin-inbox-list-ux-brainstorm.md
reviewed: 2026-01-31
---

# refactor: Admin Inbox List UX Simplification

## Review Summary

**Reviewed on:** 2026-01-31
**Reviewers:** DHH Rails Reviewer, Kieran TypeScript Reviewer, Simplicity Reviewer

### Key Feedback Applied

1. **DHH**: "Pick one layout and ship it" - cut density toggle entirely
2. **Simplicity**: Reduce scope by 60-70% - only visual hierarchy changes
3. **All reviewers**: Avatars, touch support, skeleton updates are YAGNI

### Revised Scope

- **1 file to modify** instead of 4
- **~30 lines of diff** instead of ~150
- **No new state management** - just restructure existing JSX

---

## Overview

Restructure the admin inbox `FeedbackRow` component to match the portal's visual hierarchy. This reduces visual clutter by organizing elements more clearly.

## Problem Statement

The admin inbox list is visually cluttered:

- Status shown as small inline dot instead of prominent badge
- Tags buried in meta row
- Too many separators competing for attention

## Proposed Solution

Restructure `FeedbackRow` layout to match portal's hierarchy:

**Before:**

```
[Vote] | Title
       | Preview text...
       | 🔵 Open · 📁 Feature Requests · John · 2h ago · 💬 3 · [Tag1] [Tag2]
```

**After:**

```
[Vote] | [Status Badge]
       | Title
       | Preview text...
       | [Tag1] [Tag2] [+1]
       | John · 2h ago · 3 comments · in Feature Requests
```

## Implementation

### File to Modify

**`apps/web/src/components/admin/feedback/table/feedback-row.tsx`**

Changes:

1. Import and use `StatusBadge` component (replace inline dot)
2. Move status badge above title
3. Move tags to their own row (below description)
4. Simplify meta row (remove folder icon, reduce separators)

### Code Changes

```typescript
// Add import
import { StatusBadge } from '@/components/ui/status-badge'

// Replace current layout with:
<div className="flex-1 min-w-0 px-3 py-2.5">
  {/* Status badge - above title */}
  {currentStatus && (
    <StatusBadge
      name={currentStatus.name}
      color={currentStatus.color}
      className="mb-1"
    />
  )}

  {/* Title */}
  <h3 className="font-medium text-sm text-foreground line-clamp-1 pr-24">
    {post.title}
  </h3>

  {/* Description */}
  {post.content && (
    <p className="text-xs text-muted-foreground/70 line-clamp-1 mt-0.5 pr-24">
      {post.content}
    </p>
  )}

  {/* Tags - own row */}
  {post.tags.length > 0 && (
    <div className="flex items-center gap-1 mt-1.5">
      {post.tags.slice(0, 3).map((tag) => (
        <Badge key={tag.id} variant="secondary" className="text-[10px] font-normal px-1.5 py-0">
          {tag.name}
        </Badge>
      ))}
      {post.tags.length > 3 && (
        <span className="text-[10px] text-muted-foreground/60">+{post.tags.length - 3}</span>
      )}
    </div>
  )}

  {/* Meta row - simplified */}
  <div className="flex items-center gap-2 mt-1.5 text-xs text-muted-foreground">
    <span>{post.authorName || 'Anonymous'}</span>
    <span className="text-muted-foreground/40">·</span>
    <TimeAgo date={new Date(post.createdAt)} className="text-muted-foreground/70" />
    {post.commentCount > 0 && (
      <>
        <span className="text-muted-foreground/40">·</span>
        <span className="flex items-center gap-0.5 text-muted-foreground/70">
          <ChatBubbleLeftIcon className="h-3 w-3" />
          {post.commentCount}
        </span>
      </>
    )}
    <span className="text-muted-foreground/40">·</span>
    <span>in {post.board.name}</span>
  </div>
</div>
```

## Acceptance Criteria

- [ ] StatusBadge displayed above title (not inline in meta)
- [ ] Tags displayed on their own row (3 max + overflow count)
- [ ] Meta row simplified (no folder icon, cleaner separators)
- [ ] Quick actions still work (hover overlay unchanged)
- [ ] Keyboard navigation still works (j/k, Enter, Escape)
- [ ] Focus state still works (left border indicator)

## Out of Scope (Deferred)

Per reviewer feedback, these are explicitly cut:

| Feature                  | Reason                                     |
| ------------------------ | ------------------------------------------ |
| Density toggle           | YAGNI - pick one layout                    |
| localStorage persistence | No toggle = no persistence needed          |
| Author avatars           | Admin context is internal, text sufficient |
| Always-visible ellipsis  | Touch is edge case, hover works            |
| Skeleton updates         | Polish work, not noticeable                |

## References

- StatusBadge: `apps/web/src/components/ui/status-badge.tsx`
- Current FeedbackRow: `apps/web/src/components/admin/feedback/table/feedback-row.tsx`
- Portal PostCard (reference): `apps/web/src/components/public/post-card.tsx`
