# Feedback Page Redesign: Table View with Full Page Detail

## Executive Summary

Transform the feedback inbox from a card-based list with side panel to:

1. **Dense, scannable table view** with status grouping and inline quick actions
2. **Full page detail view** for deep engagement with individual feedback

This design prioritizes **comprehension and communication** over raw throughput, recognizing that feedback tools serve a fundamentally different purpose than issue trackers.

---

## Why Full Page Detail (Not Slide-in Pane)?

We considered Linear's slide-in panel approach but rejected it for feedback tools. Here's why:

### Different Primary Workflows

| Tool Type                 | Primary Action                    | Optimization Goal |
| ------------------------- | --------------------------------- | ----------------- |
| Issue Tracker (Linear)    | Process work queue rapidly        | Throughput        |
| Feedback Tool (Quackback) | Understand & respond to customers | Comprehension     |

### The 80/20 of Feedback Triage

**80% Quick triage (from list):**

- Scan → change status → next item
- Don't need to open detail at all
- **Solution:** Put quick actions in the list row

**20% Deep engagement (full page):**

- Read carefully, understand context
- Write thoughtful official response
- Review comments, discuss with team
- **Solution:** Full page with proper space

### Why Slide-in Panes Fall Short for Feedback

1. **Feedback deserves focus** — Customer voice shouldn't feel like a "quick peek"
2. **Responses need space** — Crafting official responses in cramped sidebars feels wrong
3. **Comments matter** — Discussion threads need room to breathe
4. **URL sharing confusion** — "Open list, then click, then it slides in..." vs just share a link
5. **Browser behavior** — Back button with overlays is always confusing
6. **Mobile complexity** — Slide-ins need special handling; full pages just work

### The Decisive Insight

> A slide-in panel says: "Here's a quick peek while you work through your queue."
>
> A full page says: "This customer took time to give you feedback. Give it your attention."

---

## Design Philosophy: "Powerful List, Focused Detail"

**List View:** Optimized for scanning and quick triage

- See many items at once
- Change status without opening
- Group by status for workflow clarity

**Detail Page:** Optimized for deep engagement

- Full attention on one feedback item
- Space to read, respond, discuss
- Natural URL sharing and browser behavior

---

## Information Architecture

```
/admin/feedback                         → List view (table)
/admin/feedback?status=open&board=xyz   → Filtered list view
/admin/feedback/posts/:postId           → Full page detail
```

### Navigation Flow

```
┌─────────────────┐     click row      ┌─────────────────┐
│                 │ ─────────────────► │                 │
│   LIST VIEW     │                    │   DETAIL PAGE   │
│                 │ ◄───────────────── │                 │
└─────────────────┘   back / ← link    └─────────────────┘
                                              │
                                              │ prev/next
                                              ▼
                                       ┌─────────────────┐
                                       │  NEXT DETAIL    │
                                       └─────────────────┘
```

---

## List View Design

### Overall Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FEEDBACK INBOX                                  │
├────────────┬────────────────────────────────────────────────────────────────┤
│            │                                                                │
│  FILTERS   │  ┌──────────────────────────────────────────────────────────┐  │
│  SIDEBAR   │  │  🔍 Search...                     [Sort ▾] [+ New Post]  │  │
│            │  ├──────────────────────────────────────────────────────────┤  │
│  ┌───────┐ │  │  [Status: Open ×] [Board: Features ×]    [+ Add filter]  │  │
│  │Status │ │  ├──────────────────────────────────────────────────────────┤  │
│  │ ○ Open│ │  │                                                          │  │
│  │ ○ Rev │ │  │  ▼ OPEN (24)                                             │  │
│  │ ○ Plan│ │  │  ┌────────────────────────────────────────────────────┐  │  │
│  └───────┘ │  │  │ ▲ 47 │ Add dark mode support for the...  [●▾] [⋯] │  │  │
│            │  │  │      │ Would love to have dark mode...             │  │  │
│  ┌───────┐ │  │  │      │ 📁 Features · @john · 2h · 💬 12            │  │  │
│  │Boards │ │  │  └────────────────────────────────────────────────────┘  │  │
│  │ □ Feat│ │  │  ┌────────────────────────────────────────────────────┐  │  │
│  │ □ Bugs│ │  │  │ ▲ 31 │ API rate limiting is aggressive   [●▾] [⋯] │  │  │
│  └───────┘ │  │  │      │ Getting 429 errors when making...           │  │  │
│            │  │  │      │ 📁 Bugs · @sarah · 1d · 💬 5                 │  │  │
│  ┌───────┐ │  │  └────────────────────────────────────────────────────┘  │  │
│  │Tags   │ │  │                                                          │  │
│  │ □ ui  │ │  │  ▶ UNDER REVIEW (8)                                      │  │
│  │ □ api │ │  │                                                          │  │
│  └───────┘ │  │  ▶ PLANNED (12)                                          │  │
│            │  │                                                          │  │
│            │  │  ▶ COMPLETED (156)                                       │  │
│            │  │                                                          │  │
└────────────┴──┴──────────────────────────────────────────────────────────┴──┘
```

### FeedbackRow Component (The Heart of Quick Triage)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  ┌────────┐                                                                 │
│  │   ▲    │  Add dark mode support for the dashboard          ● ──────┐    │
│  │   47   │  Would love to have a dark mode option for...       Status│    │
│  │ votes  │  📁 Features · @john_doe · 2h ago · 💬 12     [●▾]  [⋯] ◄─┘    │
│  └────────┘                                                 │     │         │
│                                                    Quick    │     │         │
│                                                    Status   │   More        │
│                                                    Change ──┘   Menu        │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Anatomy:**

| Element       | Width      | Purpose                                  |
| ------------- | ---------- | ---------------------------------------- |
| Vote column   | 64px fixed | Primary metric, always visible           |
| Title         | flex       | Primary text, semibold, truncate         |
| Preview       | flex       | Secondary text, muted, 1 line            |
| Meta row      | flex       | Board, author, time, comments            |
| Status dot    | 8px        | Visual indicator (matches group)         |
| Quick actions | ~80px      | Hover-reveal: status dropdown, more menu |

**Row States:**

```css
/* Default */
.feedback-row {
  @apply border-b border-border/30 cursor-pointer;
}

/* Hover - reveals quick actions */
.feedback-row:hover {
  @apply bg-muted/40;
}

/* Keyboard focus */
.feedback-row:focus-visible {
  @apply ring-2 ring-primary/50 ring-inset outline-none;
}
```

### StatusGroup Component

```
EXPANDED:
┌─────────────────────────────────────────────────────────────────────────────┐
│  ▼  ● OPEN                                                             24  │
├─────────────────────────────────────────────────────────────────────────────┤
│  [FeedbackRow]                                                              │
│  [FeedbackRow]                                                              │
│  [FeedbackRow]                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

COLLAPSED:
┌─────────────────────────────────────────────────────────────────────────────┐
│  ▶  ● COMPLETED                                                       156  │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Behavior:**

- Click header to expand/collapse
- Collapse state persisted in localStorage
- Smooth height animation (150ms)
- Status color dot matches configuration

### Quick Actions Menu

Appears on row hover, right-aligned:

```
┌─────────────────────────────┐
│  [● Open ▾]      [⋯]       │
│     │              │        │
│     │              └─► Edit │
│     │                  Merge│
│     └─► Under Review       Delete
│         Planned            View in Portal
│         Completed          ─────────
│         ...                Copy Link
└─────────────────────────────┘
```

**Key insight:** Status can be changed WITHOUT opening detail. This is what makes quick triage possible.

---

## Detail Page Design

### URL Structure

```
/admin/feedback/posts/:postId
```

When navigating to detail:

- Store current filter state in sessionStorage
- "Back to Feedback" link restores that filter state
- Browser back button works naturally

### Full Page Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  HEADER BAR                                                                 │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │ ← Back to Feedback    │    Feedback › FB-142    │   3 of 24  [◀] [▶] │  │
│  │                       │                          │                    │  │
│  │                       │    [★] [Edit] [⋯]       │   Prev    Next     │  │
│  └───────────────────────────────────────────────────────────────────────┘  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  MAIN CONTENT (65%)                        │  PROPERTIES SIDEBAR (35%)     │
│  ─────────────────────                     │  ─────────────────────────    │
│                                            │                               │
│  ┌──────────────────────────────────────┐  │  ┌─────────────────────────┐  │
│  │                                      │  │  │                         │  │
│  │            ▲                         │  │  │  Status                 │  │
│  │           47                         │  │  │  ┌─────────────────┐    │  │
│  │          votes                       │  │  │  │ ● Open       ▾ │    │  │
│  │     [Vote] [Voted ✓]                 │  │  │  └─────────────────┘    │  │
│  │                                      │  │  │                         │  │
│  │  ─────────────────────────────────   │  │  │  Board                  │  │
│  │                                      │  │  │  ┌─────────────────┐    │  │
│  │  # Add dark mode support for the     │  │  │  │ Features     ▾ │    │  │
│  │    dashboard                         │  │  │  └─────────────────┘    │  │
│  │                                      │  │  │                         │  │
│  │  Would love to have a dark mode      │  │  │  Tags                   │  │
│  │  option for late-night work          │  │  │  [ui] [dashboard] [+]   │  │
│  │  sessions. The current bright        │  │  │                         │  │
│  │  theme is harsh on the eyes when     │  │  │  Assigned               │  │
│  │  working past midnight.              │  │  │  ┌─────────────────┐    │  │
│  │                                      │  │  │  │ + Assign       │    │  │
│  │  I'd suggest:                        │  │  │  └─────────────────┘    │  │
│  │  • System preference detection       │  │  │                         │  │
│  │  • Manual toggle in settings         │  │  │  Roadmap                │  │
│  │  • Scheduled dark mode               │  │  │  ┌─────────────────┐    │  │
│  │                                      │  │  │  │ + Add to...    │    │  │
│  │  [screenshot.png]                    │  │  │  └─────────────────┘    │  │
│  │                                      │  │  │                         │  │
│  └──────────────────────────────────────┘  │  │  ───────────────────    │  │
│                                            │  │                         │  │
│  ┌──────────────────────────────────────┐  │  │  DETAILS                │  │
│  │  📋 OFFICIAL RESPONSE                │  │  │                         │  │
│  │  ────────────────────────────────    │  │  │  Submitted by           │  │
│  │                                      │  │  │  john@acme.com          │  │
│  │  Thanks for the feedback! Dark mode  │  │  │  January 9, 2026        │  │
│  │  is definitely on our radar. We're   │  │  │                         │  │
│  │  planning to ship this in Q2 with    │  │  │  ───────────────────    │  │
│  │  system preference detection.        │  │  │                         │  │
│  │                                      │  │  │  Voters (47)            │  │
│  │  — Sarah from Quackback              │  │  │  👤👤👤👤👤 +42 more    │  │
│  │                                      │  │  │  [View all]             │  │
│  │  [Edit] [Delete]    Updated 2h ago   │  │  │                         │  │
│  │                                      │  │  │                         │  │
│  └──────────────────────────────────────┘  │  └─────────────────────────┘  │
│                                            │                               │
│  ┌──────────────────────────────────────┐  │                               │
│  │  💬 COMMENTS (12)                    │  │                               │
│  │  ────────────────────────────────    │  │                               │
│  │                                      │  │                               │
│  │  ┌────────────────────────────────┐  │  │                               │
│  │  │ 👤 Jane Smith · 1 hour ago     │  │  │                               │
│  │  │                                │  │  │                               │
│  │  │ This would be amazing! I work  │  │  │                               │
│  │  │ late nights and the bright UI  │  │  │                               │
│  │  │ is really hard on my eyes.     │  │  │                               │
│  │  │                                │  │  │                               │
│  │  │ [👍 3] [😊 1]    [Reply]       │  │  │                               │
│  │  └────────────────────────────────┘  │  │                               │
│  │                                      │  │                               │
│  │  ┌────────────────────────────────┐  │  │                               │
│  │  │ Write a comment...             │  │  │                               │
│  │  │                                │  │  │                               │
│  │  │                        [Send]  │  │  │                               │
│  │  └────────────────────────────────┘  │  │                               │
│  │                                      │  │                               │
│  └──────────────────────────────────────┘  │                               │
│                                            │                               │
└────────────────────────────────────────────┴───────────────────────────────┘
```

### Header Bar

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  ← Back to Feedback         Feedback › FB-142         3 of 24   [◀]  [▶]   │
│                                   │                       │         │   │   │
│  Preserves filter state          Breadcrumb            Position   Prev Next │
│  when clicked                                          in list             │
│                                                                             │
│                             [★ Favorite] [Edit] [⋯ More]                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Prev/Next Navigation:**

- Shows position: "3 of 24" (respects current filters)
- Click ◀/▶ or use `j`/`k` keys to navigate
- Navigates to `/admin/feedback/posts/:nextPostId`
- Filter context preserved in sessionStorage

### Properties Sidebar Sections

**Status** (dropdown)

```
┌─────────────────────────┐
│  Status                 │
│  ┌───────────────────┐  │
│  │ ● Open         ▾ │  │
│  └───────────────────┘  │
│                         │
│  Options:               │
│  ● Open                 │
│  ● Under Review         │
│  ● Planned              │
│  ● In Progress          │
│  ● Completed            │
│  ● Closed               │
└─────────────────────────┘
```

**Board** (dropdown)

```
┌─────────────────────────┐
│  Board                  │
│  ┌───────────────────┐  │
│  │ Features       ▾ │  │
│  └───────────────────┘  │
└─────────────────────────┘
```

**Tags** (multi-select chips)

```
┌─────────────────────────┐
│  Tags                   │
│  [ui ×] [dashboard ×]   │
│  [+ Add tag]            │
└─────────────────────────┘
```

**Assigned** (user picker)

```
┌─────────────────────────┐
│  Assigned               │
│  ┌───────────────────┐  │
│  │ 👤 Sarah Chen  × │  │
│  └───────────────────┘  │
│  or                     │
│  ┌───────────────────┐  │
│  │ + Assign          │  │
│  └───────────────────┘  │
└─────────────────────────┘
```

**Roadmap** (dropdown/multi-select)

```
┌─────────────────────────┐
│  Roadmap                │
│  [Q2 2026 ×]            │
│  [+ Add to roadmap]     │
└─────────────────────────┘
```

**Details** (read-only info)

```
┌─────────────────────────┐
│  Submitted by           │
│  john@acme.com          │
│  January 9, 2026 2:34pm │
│                         │
│  ─────────────────────  │
│                         │
│  Voters (47)            │
│  👤👤👤👤👤 +42 more     │
│  [View all voters]      │
└─────────────────────────┘
```

### Mobile Layout

On screens < 1024px, properties sidebar moves below content:

```
┌─────────────────────────────────┐
│  ← Back          3/24  [◀] [▶] │
├─────────────────────────────────┤
│                                 │
│  # Add dark mode support        │
│                                 │
│  [Content...]                   │
│                                 │
├─────────────────────────────────┤
│  PROPERTIES                     │
│  ┌───────────┐ ┌───────────┐   │
│  │ ● Open  ▾│ │Features ▾│   │
│  └───────────┘ └───────────┘   │
│  [ui] [dashboard] [+ Tag]       │
│  [+ Assign] [+ Roadmap]         │
├─────────────────────────────────┤
│                                 │
│  📋 Official Response           │
│  [...]                          │
│                                 │
│  💬 Comments (12)               │
│  [...]                          │
│                                 │
└─────────────────────────────────┘
```

---

## Component Architecture

### File Structure

```
apps/web/src/
├── components/admin/feedback/
│   ├── table/
│   │   ├── feedback-table-view.tsx    # Main list container
│   │   ├── feedback-row.tsx           # Individual row
│   │   ├── status-group.tsx           # Collapsible status section
│   │   ├── row-quick-actions.tsx      # Hover action menu
│   │   ├── table-header.tsx           # Search, sort, filter pills
│   │   └── index.ts
│   │
│   ├── detail/
│   │   ├── feedback-detail-page.tsx   # Full page container
│   │   ├── detail-header.tsx          # Back, breadcrumb, prev/next
│   │   ├── detail-content.tsx         # Vote, title, body, response
│   │   ├── detail-properties.tsx      # Sidebar with all properties
│   │   ├── detail-comments.tsx        # Comments section
│   │   ├── voters-list.tsx            # Voter avatars display
│   │   └── index.ts
│   │
│   ├── inbox-layout.tsx               # Updated for table view
│   ├── inbox-container.tsx            # List view state management
│   └── ...existing files
│
├── routes/admin/
│   ├── feedback.tsx                   # List view route
│   └── feedback.posts.$postId.tsx     # Detail page route (NEW)
```

### Route Configuration

```typescript
// routes/admin/feedback.tsx
export const Route = createFileRoute('/admin/feedback')({
  component: FeedbackListPage,
  validateSearch: (search) => ({
    status: search.status as string[] | undefined,
    board: search.board as string[] | undefined,
    tags: search.tags as string[] | undefined,
    search: search.search as string | undefined,
    sort: search.sort as 'newest' | 'oldest' | 'votes' | undefined,
  }),
})

// routes/admin/feedback/posts.$postId.tsx
export const Route = createFileRoute('/admin/feedback/posts/$postId')({
  component: FeedbackDetailPage,
  loader: async ({ params }) => {
    // Load post detail
    return { post: await fetchPost(params.postId) }
  },
})
```

### State Management for Prev/Next

```typescript
// Store filter context when navigating to detail
function navigateToDetail(postId: string, currentFilters: InboxFilters, postIds: string[]) {
  // Save context for prev/next navigation
  sessionStorage.setItem(
    'feedback-nav-context',
    JSON.stringify({
      filters: currentFilters,
      postIds: postIds,
      currentIndex: postIds.indexOf(postId),
    })
  )

  navigate({ to: '/admin/feedback/posts/$postId', params: { postId } })
}

// In detail page, read context for prev/next
function useNavigationContext() {
  const context = JSON.parse(sessionStorage.getItem('feedback-nav-context') || '{}')

  return {
    position: context.currentIndex + 1,
    total: context.postIds?.length || 0,
    prevId: context.postIds?.[context.currentIndex - 1],
    nextId: context.postIds?.[context.currentIndex + 1],
    backUrl: `/admin/feedback?${new URLSearchParams(context.filters).toString()}`,
  }
}
```

---

## Keyboard Navigation

### List View

| Key       | Action                                      |
| --------- | ------------------------------------------- |
| `j` / `↓` | Move focus to next row                      |
| `k` / `↑` | Move focus to previous row                  |
| `Enter`   | Open focused row in detail page             |
| `/`       | Focus search input                          |
| `Esc`     | Clear search / unfocus                      |
| `s`       | Open status picker for focused row          |
| `x`       | Toggle row selection (future: bulk actions) |

### Detail Page

| Key                 | Action                    |
| ------------------- | ------------------------- |
| `j` / `↓`           | Navigate to next post     |
| `k` / `↑`           | Navigate to previous post |
| `Esc` / `Backspace` | Go back to list           |
| `e`                 | Edit post                 |
| `s`                 | Focus status dropdown     |
| `c`                 | Focus comment input       |

---

## Implementation Phases

### Phase 1: Table View Foundation

1. Create `FeedbackRow` component (simplified from InboxPostCard)
2. Create `StatusGroup` component with collapse behavior
3. Create `FeedbackTableView` wrapper
4. Add row quick actions (status dropdown)
5. Update `InboxLayout` to use table view
6. Keep existing detail panel temporarily

### Phase 2: Full Page Detail

1. Create new route `/admin/feedback/posts/$postId`
2. Build `FeedbackDetailPage` component
3. Build `DetailProperties` sidebar
4. Implement prev/next navigation with context
5. Add "Back to Feedback" with filter preservation
6. Remove old side panel detail

### Phase 3: Polish & Refinement

1. Keyboard navigation for list and detail
2. Loading states and skeletons
3. Mobile responsive adjustments
4. Animation polish (group collapse, page transitions)
5. Empty states for groups/filtered results

### Phase 4: Future Enhancements

1. Bulk selection and actions
2. Merge duplicate feedback workflow
3. Unread indicators
4. Customizable columns/density

---

## Migration Considerations

### Preserving Current Functionality

All current features must work in new design:

- ✅ Status change
- ✅ Tag management
- ✅ Official response
- ✅ Comments with reactions
- ✅ Voting
- ✅ Add to roadmap
- ✅ Edit post
- ✅ Delete post
- ✅ View in portal link

### URL Changes

| Old                            | New                         |
| ------------------------------ | --------------------------- |
| `/admin/feedback?selected=xyz` | `/admin/feedback/posts/xyz` |

Redirect old URLs to new format for bookmarks/shared links.

---

## Success Metrics

After implementation:

1. **Triage efficiency** — More posts processed per session (status changes from list)
2. **Response quality** — More official responses written (full page encourages engagement)
3. **Navigation clarity** — Reduced "where am I?" confusion (natural browser behavior)
4. **Mobile usability** — Full functionality on tablets/phones
5. **Sharing adoption** — More feedback links shared between team members

---

## Appendix: Comparison with Competitors

| Feature             | Quackback (New)      | Canny          | Featurebase    | Linear                 |
| ------------------- | -------------------- | -------------- | -------------- | ---------------------- |
| List view           | Status-grouped table | Card list      | Card list      | Status-grouped table   |
| Detail view         | Full page            | Slide-over     | Slide-over     | Slide-over / full page |
| Quick status change | ✅ From list         | ✅ From list   | ✅ From list   | ✅ From list           |
| Votes prominence    | ✅ Left column       | ✅ Left side   | ✅ Left side   | ❌ Not applicable      |
| Preview text        | ✅ 1 line            | ✅ 2-3 lines   | ✅ 2-3 lines   | ❌ Title only          |
| URL sharing         | ✅ Direct links      | ⚠️ Panel state | ⚠️ Panel state | ✅ Both options        |

Our approach takes the best of both worlds: Linear's efficient table structure with the feedback-specific needs that Canny/Featurebase address (votes, previews, responses).
